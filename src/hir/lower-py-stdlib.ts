import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRExpr, HIRStmt, HIRFunction } from "./types.js";
import { F64, I64, I1, I8PTR, VOID } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import { coerceTo, coerceToF64, mapPrefix, resolveType } from "./lower-py-types.js";

export function lowerCall(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const funcNode = node.childForFieldName("function")!;
  const argsNode = node.childForFieldName("arguments")!;

  function buildPositionalArgs(): HIRExpr[] {
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
      const sysMethod = funcNode.namedChild(1)!.text;
      if (sysMethod === "exit") {
        const code = args[0] ? coerceTo(args[0], I64) : { kind: "literal_i64" as const, value: 0, type: I64 };
        return { kind: "runtime_call", func: "cs2_py_sys_exit", args: [code], returnType: VOID, type: VOID };
      }
    }

    if (objName === "os") {
      const method = funcNode.namedChild(1)!.text;
      if (method === "getcwd") {
        return { kind: "runtime_call", func: "cs2_os_getcwd", args: [], returnType: I8PTR, type: I8PTR };
      }
      if (method === "listdir") {
        const strArrType: HIRType = { kind: "array", element: I8PTR };
        const path = args[0] ?? { kind: "runtime_call" as const, func: "cs2_os_getcwd", args: [], returnType: I8PTR, type: I8PTR };
        return { kind: "runtime_call", func: "cs2_os_listdir", args: [path], returnType: strArrType, type: strArrType };
      }
      if (method === "getenv") {
        const name = args[0];
        return { kind: "runtime_call", func: "cs2_os_getenv", args: [name], returnType: I8PTR, type: I8PTR };
      }
      if (method === "mkdir") {
        return { kind: "runtime_call", func: "cs2_os_mkdir", args: [args[0]], returnType: VOID, type: VOID };
      }
      if (method === "remove") {
        return { kind: "runtime_call", func: "cs2_os_remove", args: [args[0]], returnType: VOID, type: VOID };
      }
    }

    const objNode0 = funcNode.namedChild(0)!;
    if (objNode0.type === "attribute" && objNode0.namedChild(0)!.text === "os" && objNode0.namedChild(1)!.text === "path") {
      const method = funcNode.namedChild(1)!.text;
      switch (method) {
        case "exists":
          return { kind: "runtime_call", func: "cs2_os_path_exists", args: [args[0]], returnType: I1, type: I1 };
        case "isfile":
          return { kind: "runtime_call", func: "cs2_os_path_isfile", args: [args[0]], returnType: I1, type: I1 };
        case "isdir":
          return { kind: "runtime_call", func: "cs2_os_path_isdir", args: [args[0]], returnType: I1, type: I1 };
        case "join":
          return args.slice(1).reduce((acc, seg) =>
            ({ kind: "runtime_call" as const, func: "cs2_os_path_join", args: [acc, seg], returnType: I8PTR, type: I8PTR }),
            args[0]);
        case "basename":
          return { kind: "runtime_call", func: "cs2_os_path_basename", args: [args[0]], returnType: I8PTR, type: I8PTR };
        case "dirname":
          return { kind: "runtime_call", func: "cs2_os_path_dirname", args: [args[0]], returnType: I8PTR, type: I8PTR };
        case "abspath":
          return { kind: "runtime_call", func: "cs2_os_path_abspath", args: [args[0]], returnType: I8PTR, type: I8PTR };
        case "splitext": {
          const nameE: HIRExpr = { kind: "runtime_call", func: "cs2_os_path_splitext_name", args: [args[0]], returnType: I8PTR, type: I8PTR };
          const extE: HIRExpr = { kind: "runtime_call", func: "cs2_os_path_splitext_ext", args: [args[0]], returnType: I8PTR, type: I8PTR };
          return { kind: "tuple", elements: [nameE, extE], type: { kind: "tuple", elements: [I8PTR, I8PTR] } as HIRType };
        }
      }
    }

    if (objName === "random") {
      const randMethod = funcNode.namedChild(1)!.text;
      switch (randMethod) {
        case "random":
          return { kind: "runtime_call", func: "cs2_random_random", args: [], returnType: F64, type: F64 };
        case "seed": {
          const s = args[0] ? coerceTo(args[0], I64) : { kind: "literal_i64" as const, value: 0, type: I64 };
          return { kind: "runtime_call", func: "cs2_random_seed", args: [s], returnType: VOID, type: VOID };
        }
        case "randint": {
          const a = coerceTo(args[0], I64);
          const b = coerceTo(args[1], I64);
          return { kind: "runtime_call", func: "cs2_random_randint", args: [a, b], returnType: I64, type: I64 };
        }
        case "uniform": {
          const a = coerceToF64(args[0]);
          const b = coerceToF64(args[1]);
          return { kind: "runtime_call", func: "cs2_random_uniform", args: [a, b], returnType: F64, type: F64 };
        }
        case "choice": {
          const lst = args[0];
          if (lst.type.kind === "array") {
            if (lst.type.element.kind === "i8ptr") {
              return { kind: "runtime_call", func: "cs2_random_choice_str", args: [lst], returnType: I8PTR, type: I8PTR };
            }
            return { kind: "runtime_call", func: "cs2_random_choice_num", args: [lst], returnType: F64, type: F64 };
          }
          throw new Error("random.choice requires a list");
        }
        case "shuffle": {
          const lst = args[0];
          return { kind: "runtime_call", func: "cs2_random_shuffle_num", args: [lst], returnType: VOID, type: VOID };
        }
      }
    }

    if (objName === "math") {
      const mathMethod = funcNode.namedChild(1)!.text;
      const mathMap: Record<string, string> = {
        sqrt: "cs_math_sqrt",
        floor: "cs_math_floor",
        ceil: "cs_math_ceil",
        abs: "cs_math_abs",
        sin: "cs_math_sin",
        cos: "cs_math_cos",
        tan: "cs_math_tan",
        log: "cs_math_log",
        log2: "cs_math_log2",
        exp: "cs_math_exp",
        pow: "cs_math_pow",
        fabs: "cs_math_abs",
      };
      const mathFn = mathMap[mathMethod];
      if (mathFn) {
        const isIntResult = mathMethod === "floor" || mathMethod === "ceil";
        const result: HIRExpr = {
          kind: "runtime_call",
          func: mathFn,
          args: args.map(coerceToF64),
          returnType: F64, type: F64,
        };
        if (isIntResult) return { kind: "narrow_i64", value: result, type: I64 };
        return result;
      }
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

  if (funcName === "print") {
    if (args.length === 0) {
      return {
        kind: "runtime_call",
        func: "cs_console_log",
        args: [{ kind: "literal_string", value: "", type: I8PTR }],
        returnType: VOID,
        type: VOID,
      };
    }
    const printArgs = args.map((a): HIRExpr => {
      if (a.type.kind === "i1")
        return { kind: "runtime_call", func: "cs2_py_bool_str", args: [a], returnType: I8PTR, type: I8PTR };
      if (a.type.kind === "f64")
        return { kind: "runtime_call", func: "cs2_py_float_str", args: [a], returnType: I8PTR, type: I8PTR };
      return a;
    });
    return { kind: "runtime_call", func: "cs_console_log", args: printArgs, returnType: VOID, type: VOID };
  }

  if (funcName === "len") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const prefix = arg.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      return { kind: "runtime_call", func: `${prefix}_length`, args: [arg], returnType: I64, type: I64 };
    }
    if (arg.type.kind === "map") {
      const mt = arg.type as { kind: "map"; key: HIRType; value: HIRType };
      return { kind: "runtime_call", func: `${mapPrefix(mt.key, mt.value)}_size`, args: [arg], returnType: I64, type: I64 };
    }
    if (arg.type.kind === "set") {
      const elemType = (arg.type as { kind: "set"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
      return { kind: "runtime_call", func: `${prefix}_size`, args: [arg], returnType: I64, type: I64 };
    }
    if (arg.type.kind === "i8ptr") {
      return { kind: "runtime_call", func: "cs2_str_length", args: [arg], returnType: I64, type: I64 };
    }
    throw new Error(`len() on unsupported type: ${arg.type.kind}`);
  }

  if (funcName === "str") {
    if (args.length === 0) return { kind: "literal_string", value: "", type: I8PTR };
    const arg = args[0];
    if (arg.type.kind === "i8ptr") return arg;
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [{ kind: "literal_string", value: "", type: I8PTR }, arg],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (funcName === "int") {
    if (args.length === 1) return coerceTo(args[0], I64);
    return { kind: "literal_i64", value: 0, type: I64 };
  }

  if (funcName === "float") {
    if (args.length === 1) return coerceToF64(args[0]);
    return { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "abs") {
    return {
      kind: "runtime_call",
      func: "cs_math_abs",
      args: [coerceToF64(args[0])],
      returnType: F64,
      type: F64,
    };
  }

  if (funcName === "bool") {
    if (args.length === 1) return coerceTo(args[0], I1);
    return { kind: "literal_i1", value: false, type: I1 };
  }

  if (funcName === "sum") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const retType = arg.type.element;
      return { kind: "runtime_call", func: "cs2_num_array_sum", args: [arg], returnType: retType, type: retType };
    }
    return { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "min") {
    if (args.length === 1 && args[0].type.kind === "array") {
      const retType = args[0].type.element;
      return { kind: "runtime_call", func: "cs2_num_array_min", args: [args[0]], returnType: retType, type: retType };
    }
    if (args.length === 2) {
      return {
        kind: "runtime_call",
        func: "cs_math_min",
        args: [coerceToF64(args[0]), coerceToF64(args[1])],
        returnType: F64, type: F64,
      };
    }
    return args[0] ?? { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "max") {
    if (args.length === 1 && args[0].type.kind === "array") {
      const retType = args[0].type.element;
      return { kind: "runtime_call", func: "cs2_num_array_max", args: [args[0]], returnType: retType, type: retType };
    }
    if (args.length === 2) {
      return {
        kind: "runtime_call",
        func: "cs_math_max",
        args: [coerceToF64(args[0]), coerceToF64(args[1])],
        returnType: F64, type: F64,
      };
    }
    return args[0] ?? { kind: "literal_f64", value: 0, type: F64 };
  }

  if (funcName === "sorted") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const prefix = arg.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      const copyExpr: HIRExpr = {
        kind: "runtime_call", func: "cs2_num_array_copy", args: [arg], returnType: arg.type, type: arg.type,
      };
      const copyId = ctx.freshId();
      const copyName = `__sorted_${copyId}`;
      ctx.locals.set(copyName, { id: copyId, name: copyName, type: arg.type });
      ctx.pendingStmts.push({ kind: "let", id: copyId, name: copyName, type: arg.type, init: copyExpr, mutable: false });
      const copyRef: HIRExpr = { kind: "local_get", id: copyId, type: arg.type };
      const keyNode = getKwarg("key");
      if (keyNode && keyNode.type === "lambda") {
        const lambdaId = ctx.freshId();
        const lambdaName = `__lambda_${lambdaId}`;
        const fn = lowerLambdaInline(keyNode, lambdaName, ctx);
        ctx.pendingFunctions.push(fn);
        ctx.functions.set(lambdaName, { params: fn.params.map((p) => p.type), returnType: fn.returnType });
        const closureType: HIRType = { kind: "closure", params: fn.params.map((p) => p.type), returnType: fn.returnType };
        const closureExpr: HIRExpr = { kind: "make_closure", funcName: lambdaName, captures: [], type: closureType };
        ctx.pendingStmts.push({
          kind: "expr",
          expr: { kind: "array_hof", method: "forEach", array: copyRef, callback: closureExpr,
                  bridgeFunc: `${prefix}_sort_by`, returnType: VOID, type: VOID },
        });
      } else {
        ctx.pendingStmts.push({
          kind: "expr",
          expr: { kind: "runtime_call", func: `${prefix}_sort`, args: [copyRef], returnType: VOID, type: VOID },
        });
      }
      const reverseNode = getKwarg("reverse");
      if (reverseNode && reverseNode.text === "True") {
        ctx.pendingStmts.push({
          kind: "expr",
          expr: { kind: "runtime_call", func: `${prefix}_reverse`, args: [copyRef], returnType: VOID, type: VOID },
        });
      }
      return copyRef;
    }
    return arg;
  }

  if (funcName === "reversed") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const copyExpr: HIRExpr = {
        kind: "runtime_call", func: "cs2_num_array_copy", args: [arg], returnType: arg.type, type: arg.type,
      };
      const copyId = ctx.freshId();
      const copyName = `__reversed_${copyId}`;
      ctx.locals.set(copyName, { id: copyId, name: copyName, type: arg.type });
      ctx.pendingStmts.push({ kind: "let", id: copyId, name: copyName, type: arg.type, init: copyExpr, mutable: false });
      const copyRef: HIRExpr = { kind: "local_get", id: copyId, type: arg.type };
      ctx.pendingStmts.push({
        kind: "expr",
        expr: { kind: "runtime_call", func: "cs2_num_array_reverse", args: [copyRef], returnType: VOID, type: VOID },
      });
      return copyRef;
    }
    return arg;
  }

  if (funcName === "map") {
    if (argsNode.namedChildCount >= 2) {
      const fnNode = argsNode.namedChild(0)!;
      const lstExpr = ctx.lowerExpr(argsNode.namedChild(1)!);
      if (lstExpr.type.kind === "array") {
        const closureExpr = ctx.lowerExpr(fnNode);
        const prefix = lstExpr.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
        return { kind: "array_hof", method: "map", array: lstExpr, callback: closureExpr,
                 bridgeFunc: `${prefix}_map`, returnType: lstExpr.type, type: lstExpr.type };
      }
    }
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }

  if (funcName === "filter") {
    if (argsNode.namedChildCount >= 2) {
      const fnNode = argsNode.namedChild(0)!;
      const lstExpr = ctx.lowerExpr(argsNode.namedChild(1)!);
      if (lstExpr.type.kind === "array") {
        const closureExpr = ctx.lowerExpr(fnNode);
        const prefix = lstExpr.type.element.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
        return { kind: "array_hof", method: "filter", array: lstExpr, callback: closureExpr,
                 bridgeFunc: `${prefix}_filter`, returnType: lstExpr.type, type: lstExpr.type };
      }
    }
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }

  if (funcName === "range") {
    return { kind: "literal_i64", value: 0, type: I64 };
  }

  if (funcName === "dict") {
    const mapType: HIRType = { kind: "map", key: I8PTR, value: I8PTR };
    return { kind: "alloc_map", keyType: I8PTR, valueType: I8PTR, entries: [], type: mapType };
  }

  if (funcName === "list") {
    if (args.length === 1 && args[0].type.kind === "array") return args[0];
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }

  if (funcName === "set") {
    if (args.length === 1 && args[0].type.kind === "array") {
      const elemType = (args[0].type as { kind: "array"; element: HIRType }).element;
      const setType: HIRType = { kind: "set", element: elemType };
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
      const setId = ctx.freshId();
      const setName = `__set_${setId}`;
      ctx.locals.set(setName, { id: setId, name: setName, type: setType });
      const setRef: HIRExpr = { kind: "local_get", id: setId, type: setType };
      const arrRef = args[0];
      const iId = ctx.freshId();
      const iName = `__si_${iId}`;
      ctx.locals.set(iName, { id: iId, name: iName, type: I64 });
      const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };
      const lenExpr: HIRExpr = { kind: "runtime_call",
        func: elemType.kind === "i8ptr" ? "cs2_str_array_length" : "cs2_num_array_length",
        args: [arrRef], returnType: I64, type: I64 };
      const elemExpr: HIRExpr = { kind: "index_get", array: arrRef, index: iRef, type: elemType };
      ctx.pendingStmts.push(
        { kind: "let", id: setId, name: setName, type: setType,
          init: { kind: "alloc_set", element: elemType, elements: [], type: setType }, mutable: false },
        { kind: "let", id: iId, name: iName, type: I64,
          init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
        { kind: "for",
          condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
          update: { kind: "local_set", id: iId,
            value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
            type: I64 },
          body: [{ kind: "expr",
            expr: { kind: "runtime_call", func: `${prefix}_add`, args: [setRef, elemExpr], returnType: VOID, type: VOID } }] }
      );
      return setRef;
    }
    const setType: HIRType = { kind: "set", element: F64 };
    return { kind: "alloc_set", element: F64, elements: [], type: setType };
  }

  if (funcName === "any") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const elemType = (arg.type as { kind: "array"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      return { kind: "runtime_call", func: `${prefix}_any`, args: [arg], returnType: I1, type: I1 };
    }
    return { kind: "literal_i1", value: false, type: I1 };
  }

  if (funcName === "all") {
    const arg = args[0];
    if (arg.type.kind === "array") {
      const elemType = (arg.type as { kind: "array"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      return { kind: "runtime_call", func: `${prefix}_all`, args: [arg], returnType: I1, type: I1 };
    }
    return { kind: "literal_i1", value: true, type: I1 };
  }

  const classInfo = ctx.classes.get(funcName);
  if (classInfo) {
    const thisType: HIRType = { kind: "ptr", pointee: funcName };
    return {
      kind: "call",
      callee: `${funcName}_constructor`,
      args,
      returnType: thisType,
      type: thisType,
    };
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
    return { kind: "call", callee: funcName, args: callArgs, returnType: fnInfo.returnType, type: fnInfo.returnType };
  }

  return { kind: "call", callee: funcName, args, returnType: I64, type: I64 };
}

function lowerLambdaInline(node: SyntaxNode, name: string, ctx: LowerCtx): HIRFunction {
  const paramsNode = node.childForFieldName("parameters");
  const savedLocals = new Map(ctx.locals);
  const envParam = { id: ctx.freshId(), name: "__env", type: I8PTR };
  const hirParams = [envParam];

  if (paramsNode) {
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const p = paramsNode.namedChild(i)!;
      const paramId = ctx.freshId();
      const paramName = p.type === "typed_parameter" ? p.namedChild(0)!.text : p.text;
      const paramType = p.type === "typed_parameter" ? resolveType(p.childForFieldName("type")!, ctx) : F64;
      hirParams.push({ id: paramId, name: paramName, type: paramType });
      ctx.locals.set(paramName, { id: paramId, name: paramName, type: paramType });
    }
  }

  const bodyNode = node.childForFieldName("body")!;
  const bodyExpr = ctx.lowerExpr(bodyNode);
  ctx.locals = savedLocals;

  return {
    name,
    params: hirParams,
    returnType: bodyExpr.type,
    body: [{ kind: "return", value: bodyExpr }],
    isAsync: false,
    captures: [],
  };
}

export function lowerMethodCall(attrNode: SyntaxNode, args: HIRExpr[], ctx: LowerCtx): HIRExpr {
  const obj = ctx.lowerExpr(attrNode.namedChild(0)!);
  const methodName = attrNode.namedChild(1)!.text;

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
  }

  if (obj.type.kind === "map") {
    const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
    const prefix = mapPrefix(mt.key, mt.value);
    const mapType = obj.type;
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
        return { kind: "runtime_call", func: `${prefix}_delete`, args: [obj, coerceTo(args[0], mt.key)], returnType: I64, type: I64 };
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
          return { kind: "runtime_call", func: `${prefix}_copy`, args: [args[0]], returnType: mapType, type: mapType };
        }
        return obj;
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
      default:
        throw new Error(`unsupported array method: ${methodName}`);
    }
  }

  if (obj.type.kind === "i8ptr") {
    const strMethods: Record<string, { func: string; returnType: HIRType }> = {
      upper: { func: "cs2_str_to_upper", returnType: I8PTR },
      lower: { func: "cs2_str_to_lower", returnType: I8PTR },
      strip: { func: "cs2_str_trim", returnType: I8PTR },
      lstrip: { func: "cs2_str_trim_start", returnType: I8PTR },
      rstrip: { func: "cs2_str_trim_end", returnType: I8PTR },
      replace: { func: "cs2_str_replace", returnType: I8PTR },
      startswith: { func: "cs2_str_starts_with", returnType: I1 },
      endswith: { func: "cs2_str_ends_with", returnType: I1 },
      find: { func: "cs2_str_index_of", returnType: I64 },
      index: { func: "cs2_str_index_of", returnType: I64 },
    };
    const info = strMethods[methodName];
    if (info) {
      return { kind: "runtime_call", func: info.func, args: [obj, ...args], returnType: info.returnType, type: info.returnType };
    }
    if (methodName === "split") {
      const sep = args[0] ?? { kind: "literal_string", value: " ", type: I8PTR };
      return { kind: "runtime_call", func: "cs2_str_split", args: [obj, sep], returnType: { kind: "array", element: I8PTR }, type: { kind: "array", element: I8PTR } };
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
