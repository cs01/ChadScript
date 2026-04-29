import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRExpr } from "./types.js";
import { I64, I1, I8PTR, VOID, BOXED, DYNOBJ } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import { coerceTo, mapPrefix, extractStringContent } from "./lower-py-types.js";
import { lowerBuiltinCall, lowerLambdaInline } from "./lower-py-builtins.js";
import { lowerCounterCall, lowerDequeCall, lowerDequeMethodCall } from "./lower-py-collections.js";
import { lowerSysCall, lowerOsCall, lowerOsPathCall, lowerRandomCall, lowerMathCall, isOsPathCall } from "./lower-py-os.js";
import { lowerJsonCall, lowerReCall, lowerFileMethodCall, lowerReMatchMethodCall } from "./lower-py-io.js";

export { lowerLambdaInline };

export function lowerCall(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const funcNode = node.childForFieldName("function")!;
  const argsNode = node.childForFieldName("arguments")!;

  function buildPositionalArgs(): HIRExpr[] {
    if (argsNode.type === "generator_expression") return [ctx.lowerExpr(argsNode)];
    const result: HIRExpr[] = [];
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i)!;
      if (a.type !== "keyword_argument") result.push(ctx.lowerExpr(a));
    }
    return result;
  }

  function getKwarg(name: string): SyntaxNode | undefined {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i)!;
      if (a.type === "keyword_argument" && a.namedChild(0)!.text === name) {
        return a.namedChild(1)!;
      }
    }
    return undefined;
  }

  if (funcNode.type === "attribute") {
    const args = buildPositionalArgs();
    const objName = funcNode.namedChild(0)!.text;

    if (objName === "sys") {
      const result = lowerSysCall(funcNode.namedChild(1)!.text, args);
      if (result) return result;
    }

    if (objName === "os") {
      const result = lowerOsCall(funcNode.namedChild(1)!.text, args);
      if (result) return result;
    }

    if (isOsPathCall(funcNode)) {
      const result = lowerOsPathCall(funcNode.namedChild(1)!.text, args);
      if (result) return result;
    }

    if (objName === "random") {
      const result = lowerRandomCall(funcNode.namedChild(1)!.text, args);
      if (result) return result;
    }

    if (objName === "json") {
      const result = lowerJsonCall(funcNode.namedChild(1)!.text, args);
      if (result) return result;
    }

    if (objName === "re") {
      const result = lowerReCall(funcNode.namedChild(1)!.text, args);
      if (result) return result;
    }

    if (objName === "math") {
      const result = lowerMathCall(funcNode.namedChild(1)!.text, args);
      if (result) return result;
    }

    const objNode = funcNode.namedChild(0)!;
    if (objNode.type === "call" && objNode.childForFieldName("function")?.text === "super") {
      const rawMethodName = funcNode.namedChild(1)!.text;
      const methodName = rawMethodName === "__init__" ? "init" : rawMethodName;
      const parentName = ctx.currentClassName ? ctx.classParents.get(ctx.currentClassName) : undefined;
      if (parentName) {
        const fnKey = `${parentName}_${methodName}`;
        const fnInfo = ctx.functions.get(fnKey);
        const returnType = fnInfo?.returnType ?? VOID;
        const selfLocal = ctx.locals.get("self");
        const selfExpr: HIRExpr = selfLocal
          ? { kind: "local_get", id: selfLocal.id, type: selfLocal.type }
          : { kind: "literal_null", type: VOID };
        return { kind: "call", callee: fnKey, args: [selfExpr, ...args], returnType, type: returnType };
      }
    }

    return lowerMethodCall(funcNode, args, ctx);
  }

  const args = buildPositionalArgs();
  const funcName = funcNode.text;

  if (funcName === "Counter" && !ctx.classes.has("Counter")) {
    const result = lowerCounterCall(args, ctx);
    if (result) return result;
  }

  if (funcName === "deque" && !ctx.classes.has("deque")) {
    return lowerDequeCall(args, ctx);
  }

  const builtinResult = lowerBuiltinCall(funcName, args, argsNode, getKwarg, ctx);
  if (builtinResult) return builtinResult;

  const classInfo = ctx.classes.get(funcName);
  if (classInfo) {
    if (ctx.dynobjClasses.has(funcName)) {
      const ctorInfo = ctx.functions.get(`${funcName}_constructor`);
      let callArgs = args;
      if (ctorInfo) {
        callArgs = args.map((a, i) => {
          const pt = ctorInfo.params[i];
          if (pt?.kind === "boxed" && a.type.kind !== "boxed") {
            return { kind: "box" as const, value: a, fromType: a.type, type: BOXED };
          }
          return a;
        });
      }
      return { kind: "call", callee: `${funcName}_constructor`, args: callArgs, returnType: DYNOBJ, type: DYNOBJ };
    }
    const thisType: HIRType = { kind: "ptr", pointee: funcName };
    return { kind: "call", callee: `${funcName}_constructor`, args, returnType: thisType, type: thisType };
  }

  const fnInfo = ctx.functions.get(funcName);
  if (fnInfo) {
    let callArgs = args;
    if (fnInfo.variadicIdx !== undefined) {
      const vi = fnInfo.variadicIdx;
      const elemType = (fnInfo.params[vi] as { kind: "array"; element: HIRType }).element;
      const restArgs = args.slice(vi);
      const arrayExpr: HIRExpr = {
        kind: "alloc_array", elementType: elemType,
        initialValues: restArgs.map((a) => coerceTo(a, elemType)),
        type: { kind: "array", element: elemType },
      };
      callArgs = [...args.slice(0, vi), arrayExpr];
    }
    callArgs = callArgs.map((a, i) => {
      const paramType = fnInfo.params[i];
      if (paramType?.kind === "boxed" && a.type.kind !== "boxed") {
        return { kind: "box" as const, value: a, fromType: a.type, type: BOXED };
      }
      return a;
    });
    return { kind: "call", callee: funcName, args: callArgs, returnType: fnInfo.returnType, type: fnInfo.returnType };
  }

  return { kind: "call", callee: funcName, args, returnType: I64, type: I64 };
}

export function lowerMethodCall(attrNode: SyntaxNode, args: HIRExpr[], ctx: LowerCtx): HIRExpr {
  const obj = ctx.lowerExpr(attrNode.namedChild(0)!);
  const methodName = attrNode.namedChild(1)!.text;

  if (obj.type.kind === "dynobj") {
    const objName = attrNode.namedChild(0)!.text;
    const className = ctx.instanceClasses.get(objName) ?? ctx.currentClassName ?? null;
    if (className && ctx.dynobjClasses.has(className)) {
      const fnKey = `${className}_${methodName}`;
      const fnInfo = ctx.functions.get(fnKey);
      const returnType = fnInfo?.returnType ?? VOID;
      return { kind: "call", callee: fnKey, args: [obj, ...args], returnType, type: returnType };
    }
    throw new Error(`dynobj method call: cannot resolve class for ${objName}.${methodName}`);
  }

  if (obj.type.kind === "ptr") {
    const cls = ctx.classes.get(obj.type.pointee);
    if (cls) {
      const owner = resolveMethodOwner(obj.type.pointee, methodName, ctx);
      const fnKey = `${owner}_${methodName}`;
      const fnInfo = ctx.functions.get(fnKey);
      const returnType = fnInfo?.returnType ?? VOID;
      const selfType: HIRType = { kind: "ptr", pointee: owner };
      return {
        kind: "call",
        callee: fnKey,
        args: [obj.type.pointee === owner ? obj : { ...obj, type: selfType }, ...args],
        returnType,
        type: returnType,
      };
    }

    if (obj.type.pointee === "__file") {
      const result = lowerFileMethodCall(obj, methodName, args, ctx);
      if (result) return result;
    }

    if (obj.type.pointee === "__deque_num") {
      const result = lowerDequeMethodCall(obj, methodName, args, ctx);
      if (result) return result;
    }

    if (obj.type.pointee === "__re_match") {
      const result = lowerReMatchMethodCall(obj, methodName, args);
      if (result) return result;
    }
  }

  if (obj.type.kind === "map") {
    const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
    const prefix = mapPrefix(mt.key, mt.value);
    switch (methodName) {
      case "get": {
        if (args.length >= 2) {
          return {
            kind: "runtime_call",
            func: `${prefix}_get_or`,
            args: [obj, coerceTo(args[0], mt.key), coerceTo(args[1], mt.value)],
            returnType: mt.value,
            type: mt.value,
          };
        }
        return {
          kind: "runtime_call",
          func: `${prefix}_get`,
          args: [obj, coerceTo(args[0], mt.key)],
          returnType: mt.value,
          type: mt.value,
        };
      }
      case "pop":
        return { kind: "runtime_call", func: `${prefix}_pop`, args: [obj, coerceTo(args[0], mt.key)], returnType: mt.value, type: mt.value };
      case "keys":
        return { kind: "runtime_call", func: `${prefix}_keys`, args: [obj], returnType: { kind: "array", element: mt.key }, type: { kind: "array", element: mt.key } };
      case "values":
        return { kind: "runtime_call", func: `${prefix}_values`, args: [obj], returnType: { kind: "array", element: mt.value }, type: { kind: "array", element: mt.value } };
      case "items":
        return obj;
      case "clear":
        return { kind: "runtime_call", func: `${prefix}_clear`, args: [obj], returnType: VOID, type: VOID };
      case "update": {
        if (args.length > 0) {
          return { kind: "runtime_call", func: `${prefix}_update`, args: [obj, args[0]], returnType: VOID, type: VOID };
        }
        return { kind: "literal_null", type: VOID };
      }
      default:
        throw new Error(`unsupported map method: ${methodName}`);
    }
  }

  if (obj.type.kind === "set") {
    const elemType = (obj.type as { kind: "set"; element: HIRType }).element;
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
    switch (methodName) {
      case "add":
        return { kind: "runtime_call", func: `${prefix}_add`, args: [obj, coerceTo(args[0], elemType)], returnType: VOID, type: VOID };
      case "remove":
      case "discard":
        return { kind: "runtime_call", func: `${prefix}_delete`, args: [obj, coerceTo(args[0], elemType)], returnType: I64, type: I64 };
      case "clear":
        return { kind: "runtime_call", func: `${prefix}_clear`, args: [obj], returnType: VOID, type: VOID };
      case "values":
      case "__iter__": {
        const arrType: HIRType = { kind: "array", element: elemType };
        return { kind: "runtime_call", func: `${prefix}_values`, args: [obj], returnType: arrType, type: arrType };
      }
      default:
        throw new Error(`unsupported set method: ${methodName}`);
    }
  }

  if (obj.type.kind === "array") {
    const elemType = obj.type.element;
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
    switch (methodName) {
      case "append":
        return {
          kind: "runtime_call",
          func: `${prefix}_push`,
          args: [obj, coerceTo(args[0], elemType)],
          returnType: VOID,
          type: VOID,
        };
      case "pop":
        return { kind: "runtime_call", func: `${prefix}_pop`, args: [obj], returnType: elemType, type: elemType };
      case "reverse":
        return { kind: "runtime_call", func: `${prefix}_reverse`, args: [obj], returnType: VOID, type: VOID };
      case "index":
        return {
          kind: "runtime_call",
          func: `${prefix}_index_of`,
          args: [obj, coerceTo(args[0], elemType)],
          returnType: I64,
          type: I64,
        };
      case "insert":
        return { kind: "runtime_call", func: `${prefix}_insert`, args: [obj, coerceTo(args[0], I64), coerceTo(args[1], elemType)], returnType: VOID, type: VOID };
      case "sort":
        return { kind: "runtime_call", func: `${prefix}_sort`, args: [obj], returnType: VOID, type: VOID };
      case "extend": {
        const arrB = args[0];
        const iId = ctx.freshId();
        const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };
        const lenE: HIRExpr = { kind: "runtime_call", func: `${prefix}_length`, args: [arrB], returnType: I64, type: I64 };
        ctx.pendingStmts.push(
          { kind: "let", id: iId, name: `__ext_${iId}`, type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
          { kind: "for",
            condition: { kind: "binary", op: "lt", left: iRef, right: lenE, type: I1 },
            update: { kind: "local_set", id: iId, value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 }, type: I64 },
            body: [{ kind: "expr", expr: { kind: "runtime_call", func: `${prefix}_push`, args: [obj, { kind: "index_get", array: arrB, index: iRef, type: elemType }], returnType: VOID, type: VOID } }] }
        );
        return { kind: "literal_null", type: VOID };
      }
      default:
        throw new Error(`unsupported array method: ${methodName}`);
    }
  }

  if (obj.type.kind === "i8ptr") {
    const strArrTypeStr: HIRType = { kind: "array", element: I8PTR };
    const strMethods: Record<string, { func: string; returnType: HIRType }> = {
      upper: { func: "cs2_str_to_upper", returnType: I8PTR },
      lower: { func: "cs2_str_to_lower", returnType: I8PTR },
      strip: { func: "cs2_str_trim", returnType: I8PTR },
      lstrip: { func: "cs2_str_trim_start", returnType: I8PTR },
      rstrip: { func: "cs2_str_trim_end", returnType: I8PTR },
      replace: { func: "cs2_str_replace_all", returnType: I8PTR },
      startswith: { func: "cs2_str_starts_with", returnType: I1 },
      endswith: { func: "cs2_str_ends_with", returnType: I1 },
      find: { func: "cs2_str_index_of", returnType: I64 },
      index: { func: "cs2_str_index_of", returnType: I64 },
      count: { func: "cs2_str_count", returnType: I64 },
      isdigit: { func: "cs2_str_isdigit", returnType: I1 },
      isalpha: { func: "cs2_str_isalpha", returnType: I1 },
      isspace: { func: "cs2_str_isspace", returnType: I1 },
    };
    const info = strMethods[methodName];
    if (info) {
      return { kind: "runtime_call", func: info.func, args: [obj, ...args], returnType: info.returnType, type: info.returnType };
    }
    if (methodName === "join") {
      return { kind: "runtime_call", func: "cs2_str_join", args: [obj, args[0]], returnType: I8PTR, type: I8PTR };
    }
    if (methodName === "split") {
      if (args.length === 0) return { kind: "runtime_call", func: "cs2_str_split_whitespace", args: [obj], returnType: strArrTypeStr, type: strArrTypeStr };
      return { kind: "runtime_call", func: "cs2_str_split", args: [obj, args[0]], returnType: strArrTypeStr, type: strArrTypeStr };
    }
    if (methodName === "format") {
      const fmtNode = attrNode.namedChild(0)!;
      const fmtStr = extractStringContent(fmtNode);
      const parts = fmtStr.split("{}");
      let result: HIRExpr = { kind: "literal_string", value: parts[0], type: I8PTR };
      for (let i = 0; i < args.length; i++) {
        result = { kind: "runtime_call", func: "cs_string_concat", args: [result, args[i]], returnType: I8PTR, type: I8PTR };
        const lit = parts[i + 1] ?? "";
        if (lit) result = { kind: "runtime_call", func: "cs_string_concat", args: [result, { kind: "literal_string", value: lit, type: I8PTR }], returnType: I8PTR, type: I8PTR };
      }
      return result;
    }
    throw new Error(`unsupported string method: ${methodName}`);
  }

  throw new Error(`method call on unsupported type: ${methodName} on ${obj.type.kind}`);
}

function resolveMethodOwner(className: string, methodName: string, ctx: LowerCtx): string {
  const fnKey = `${className}_${methodName}`;
  if (ctx.functions.has(fnKey)) return className;
  const parent = ctx.classParents.get(className);
  if (parent) return resolveMethodOwner(parent, methodName, ctx);
  return className;
}
