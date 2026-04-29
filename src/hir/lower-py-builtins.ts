import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRExpr, HIRFunction } from "./types.js";
import { F64, I64, I1, I8PTR, VOID } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import { coerceTo, coerceToF64, mapPrefix, resolveType } from "./lower-py-types.js";

export function lowerLambdaInline(node: SyntaxNode, name: string, ctx: LowerCtx): HIRFunction {
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

export function lowerBuiltinCall(
  funcName: string,
  args: HIRExpr[],
  argsNode: SyntaxNode,
  getKwarg: (name: string) => SyntaxNode | undefined,
  ctx: LowerCtx,
): HIRExpr | null {
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
      if (a.type.kind === "array") {
        const elem = (a.type as { kind: "array"; element: HIRType }).element;
        const fn = elem.kind === "i8ptr" ? "cs2_py_str_array_repr" : "cs2_py_num_array_repr";
        return { kind: "runtime_call", func: fn, args: [a], returnType: I8PTR, type: I8PTR };
      }
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
    if (arg.type.kind === "ptr") {
      const pt = (arg.type as { kind: "ptr"; pointee: string }).pointee;
      if (pt === "__deque_num") return { kind: "runtime_call", func: "cs2_deque_num_len", args: [arg], returnType: I64, type: I64 };
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

  if (funcName === "round") {
    return { kind: "narrow_i64", value: coerceToF64(args[0]), type: I64 };
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

  if (funcName === "open") {
    const fileType: HIRType = { kind: "ptr", pointee: "__file" };
    const path = args[0];
    const mode = args[1] ?? { kind: "literal_string" as const, value: "r", type: I8PTR };
    return { kind: "runtime_call", func: "cs2_io_open", args: [path, mode], returnType: fileType, type: fileType };
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

  return null;
}
