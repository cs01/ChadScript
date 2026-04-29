import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRExpr, HIRStmt, HIRFunction, HIRParam } from "./types.js";
import { F64, I64, I1, I8PTR, VOID } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import {
  coerceTo, coerceToF64, mapPrefix, resolveArithResultType,
  resolveType, inferType, namedChildren, extractStringContent,
  interpretEscape,
} from "./lower-py-types.js";
import { lowerCall } from "./lower-py-stdlib.js";

export function lowerExpr(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  switch (node.type) {
    case "integer":
      return { kind: "literal_i64", value: parseInt(node.text, 10), type: I64 };
    case "float":
      return { kind: "literal_f64", value: parseFloat(node.text), type: F64 };
    case "string":
      return lowerString(node, ctx);
    case "true":
      return { kind: "literal_i1", value: true, type: I1 };
    case "false":
      return { kind: "literal_i1", value: false, type: I1 };
    case "none":
      return { kind: "literal_null", type: VOID };
    case "identifier":
      return lowerIdentifier(node, ctx);
    case "binary_operator":
      return lowerBinaryOp(node, ctx);
    case "comparison_operator":
      return lowerComparison(node, ctx);
    case "boolean_operator":
      return lowerBooleanOp(node, ctx);
    case "unary_operator":
      return lowerUnaryOp(node, ctx);
    case "not_operator":
      return { kind: "unary", op: "not", operand: ctx.lowerExpr(node.namedChild(0)!), type: I1 };
    case "call":
      return lowerCall(node, ctx);
    case "parenthesized_expression":
      return ctx.lowerExpr(node.namedChild(0)!);
    case "list":
      return lowerListLiteral(node, ctx);
    case "list_comprehension":
    case "generator_expression":
      return lowerListComp(node, ctx);
    case "dictionary_comprehension":
      return lowerDictComp(node, ctx);
    case "dictionary":
      return lowerDictLiteral(node, ctx);
    case "tuple":
    case "expression_list":
      return lowerTupleLiteral(node, ctx);
    case "subscript":
      return lowerSubscript(node, ctx);
    case "attribute":
      return lowerAttribute(node, ctx);
    case "lambda": {
      const lambdaId = ctx.freshId();
      const lambdaName = `__lambda_${lambdaId}`;
      const fn = lowerLambda(node, lambdaName, ctx);
      ctx.pendingFunctions.push(fn);
      ctx.functions.set(lambdaName, { params: fn.params.map((p) => p.type), returnType: fn.returnType });
      const closureType: HIRType = { kind: "closure", params: fn.params.map((p) => p.type), returnType: fn.returnType };
      return { kind: "make_closure", funcName: lambdaName, captures: [], type: closureType };
    }
    case "named_expression": {
      const walrusName = node.namedChild(0)!.text;
      const walrusVal = ctx.lowerExpr(node.namedChild(1)!);
      const existing = ctx.locals.get(walrusName);
      if (existing) {
        ctx.pendingStmts.push({ kind: "expr", expr: { kind: "local_set", id: existing.id, value: walrusVal, type: walrusVal.type } });
        return { kind: "local_get", id: existing.id, type: walrusVal.type };
      }
      const wId = ctx.freshId();
      ctx.locals.set(walrusName, { id: wId, name: walrusName, type: walrusVal.type });
      ctx.pendingStmts.push({ kind: "let", id: wId, name: walrusName, type: walrusVal.type, init: walrusVal, mutable: true });
      return { kind: "local_get", id: wId, type: walrusVal.type };
    }
    default:
      throw new Error(`unsupported expression: ${node.type} "${node.text}"`);
  }
}

export function lowerLambda(node: SyntaxNode, name: string, ctx: LowerCtx): HIRFunction {
  const paramsNode = node.childForFieldName("parameters");
  const savedLocals = new Map(ctx.locals);
  const envParam: HIRParam = { id: ctx.freshId(), name: "__env", type: I8PTR };
  const hirParams: HIRParam[] = [envParam];

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

function lowerString(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const start = node.childCount > 0 ? node.child(0)!.text : "";
  if (start.startsWith("f") || start.startsWith("F")) {
    return lowerFString(node, ctx);
  }
  return { kind: "literal_string", value: extractStringContent(node), type: I8PTR };
}

function lowerFString(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const parts: HIRExpr[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    if (child.type === "string_content") {
      if (child.text) parts.push({ kind: "literal_string", value: child.text, type: I8PTR });
    } else if (child.type === "escape_sequence") {
      parts.push({ kind: "literal_string", value: interpretEscape(child.text), type: I8PTR });
    } else if (child.type === "interpolation") {
      parts.push(ctx.lowerExpr(child.namedChild(0)!));
    }
  }

  if (parts.length === 0) return { kind: "literal_string", value: "", type: I8PTR };
  if (parts.length === 1 && parts[0].type.kind === "i8ptr") return parts[0];

  let result = parts[0];
  if (result.type.kind !== "i8ptr") {
    result = {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [{ kind: "literal_string", value: "", type: I8PTR }, result],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  for (let i = 1; i < parts.length; i++) {
    result = {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [result, parts[i]],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  return result;
}

function lowerIdentifier(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const name = node.text;
  const local = ctx.locals.get(name);
  if (local) return { kind: "local_get", id: local.id, type: local.type };
  if (name === "math" || name === "random" || name === "sys" || name === "os" || name === "json" || name === "re") return { kind: "literal_null", type: VOID };
  throw new Error(`undefined variable: ${name}`);
}

function lowerBinaryOp(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const left = ctx.lowerExpr(node.namedChild(0)!);
  const right = ctx.lowerExpr(node.namedChild(1)!);
  const opNode = node.child(1)!;
  const op = opNode.text;

  if (op === "+" && (left.type.kind === "i8ptr" || right.type.kind === "i8ptr")) {
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [left, right],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (op === "**") {
    return {
      kind: "runtime_call",
      func: "pow",
      args: [coerceToF64(left), coerceToF64(right)],
      returnType: F64,
      type: F64,
    };
  }

  const opMap: Record<string, string> = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "%": "rem",
    "//": "div",
    "<<": "shl",
    ">>": "shr",
    "&": "bit_and",
    "|": "bit_or",
    "^": "bit_xor",
  };
  const hirOp = opMap[op];
  if (!hirOp) throw new Error(`unsupported binary operator: ${op}`);

  const resultType = resolveArithResultType(left.type, right.type);
  return {
    kind: "binary",
    op: hirOp as any,
    left: coerceTo(left, resultType),
    right: coerceTo(right, resultType),
    type: resultType,
  };
}

function lowerComparison(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const left = ctx.lowerExpr(node.namedChild(0)!);
  const right = ctx.lowerExpr(node.namedChild(1)!);

  const opParts: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (!c.isNamed) {
      const t = c.text.trim();
      if (t) opParts.push(t);
    }
  }
  const opText = opParts.join(" ");

  if (opText === "in" || opText === "not in") {
    const rightType = right.type;
    if (rightType.kind === "map") {
      const mt = rightType as { kind: "map"; key: HIRType; value: HIRType };
      const prefix = mapPrefix(mt.key, mt.value);
      const hasExpr: HIRExpr = {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [right, coerceTo(left, mt.key)],
        returnType: I1,
        type: I1,
      };
      return opText === "not in"
        ? { kind: "unary", op: "not", operand: hasExpr, type: I1 }
        : hasExpr;
    }
    if (rightType.kind === "set") {
      const elemType = (rightType as { kind: "set"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
      const hasExpr: HIRExpr = {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [right, coerceTo(left, elemType)],
        returnType: I1,
        type: I1,
      };
      return opText === "not in"
        ? { kind: "unary", op: "not", operand: hasExpr, type: I1 }
        : hasExpr;
    }
    if (rightType.kind === "array") {
      const elemType = (rightType as { kind: "array"; element: HIRType }).element;
      const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
      const hasExpr: HIRExpr = {
        kind: "runtime_call",
        func: `${prefix}_index_of`,
        args: [right, coerceTo(left, elemType)],
        returnType: I64,
        type: I64,
      };
      const geZero: HIRExpr = { kind: "binary", op: "ge", left: hasExpr, right: { kind: "literal_i64", value: 0, type: I64 }, type: I1 };
      return opText === "not in"
        ? { kind: "unary", op: "not", operand: geZero, type: I1 }
        : geZero;
    }
    if (rightType.kind === "i8ptr") {
      const includesExpr: HIRExpr = {
        kind: "runtime_call",
        func: "cs2_str_includes",
        args: [right, coerceTo(left, I8PTR)],
        returnType: I1,
        type: I1,
      };
      return opText === "not in"
        ? { kind: "unary", op: "not", operand: includesExpr, type: I1 }
        : includesExpr;
    }
    throw new Error(`'${opText}' not supported for type: ${rightType.kind}`);
  }

  if (opText === "is" || opText === "is not") {
    const isNullCheck = right.type.kind === "void" || (right.kind === "literal_null" as any);
    let cmp: HIRExpr;
    if (isNullCheck && left.type.kind === "void") {
      // both None — always equal
      cmp = { kind: "literal_i1", value: true, type: I1 };
    } else if (isNullCheck && (left.type.kind === "ptr" || left.type.kind === "i8ptr")) {
      cmp = { kind: "binary", op: "eq", left, right: { kind: "literal_null", type: left.type }, type: I1 };
    } else {
      const commonType = resolveArithResultType(left.type, right.type);
      cmp = { kind: "binary", op: "eq", left: coerceTo(left, commonType), right: coerceTo(right, commonType), type: I1 };
    }
    return opText === "is not" ? { kind: "unary", op: "not", operand: cmp, type: I1 } : cmp;
  }

  if ((opText === "==" || opText === "!=") && left.type.kind === "i8ptr" && right.type.kind === "i8ptr") {
    const eqExpr: HIRExpr = { kind: "runtime_call", func: "cs2_str_equals", args: [left, right], returnType: I1, type: I1 };
    return opText === "!=" ? { kind: "unary", op: "not", operand: eqExpr, type: I1 } : eqExpr;
  }

  const opMap: Record<string, string> = {
    "==": "eq", "!=": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge",
  };
  const hirOp = opMap[opText];
  if (!hirOp) throw new Error(`unsupported comparison operator: ${opText}`);

  const commonType = resolveArithResultType(left.type, right.type);
  return {
    kind: "binary",
    op: hirOp as any,
    left: coerceTo(left, commonType),
    right: coerceTo(right, commonType),
    type: I1,
  };
}

function lowerBooleanOp(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const left = ctx.lowerExpr(node.namedChild(0)!);
  const right = ctx.lowerExpr(node.namedChild(1)!);
  const op = node.child(1)!.text;
  return {
    kind: "binary",
    op: op === "and" ? "and" : "or",
    left,
    right,
    type: left.type,
  };
}

function lowerUnaryOp(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const opText = node.child(0)!.text;
  const operand = ctx.lowerExpr(node.namedChild(0)!);
  switch (opText) {
    case "-":
      return { kind: "unary", op: "neg", operand, type: operand.type };
    case "~":
      return { kind: "unary", op: "bit_not", operand, type: operand.type };
    default:
      throw new Error(`unsupported unary operator: ${opText}`);
  }
}

function lowerListLiteral(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  if (node.namedChildCount === 0) {
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }
  const elements = namedChildren(node).map((c) => ctx.lowerExpr(c));
  const elemType = elements[0].type;
  return {
    kind: "alloc_array",
    elementType: elemType,
    initialValues: elements,
    type: { kind: "array", element: elemType },
  };
}

function lowerSlice(arr: HIRExpr, sliceNode: SyntaxNode, ctx: LowerCtx): HIRExpr {
  // Determine start/end by finding colon position among raw children
  let colonIdx = -1;
  for (let i = 0; i < sliceNode.childCount; i++) {
    if (sliceNode.child(i)!.type === ":") { colonIdx = i; break; }
  }
  let startNode: SyntaxNode | null = null;
  let endNode: SyntaxNode | null = null;
  for (let i = 0; i < sliceNode.childCount; i++) {
    const c = sliceNode.child(i)!;
    if (!c.isNamed) continue;
    if (i < colonIdx) startNode = c;
    else if (i > colonIdx) endNode = c;
  }

  if (arr.type.kind === "i8ptr") {
    const startExpr: HIRExpr = startNode
      ? coerceTo(ctx.lowerExpr(startNode), I64)
      : { kind: "literal_i64", value: 0, type: I64 };
    const endExpr: HIRExpr = endNode
      ? coerceTo(ctx.lowerExpr(endNode), I64)
      : { kind: "runtime_call", func: "cs2_str_length", args: [arr], returnType: I64, type: I64 };
    return { kind: "runtime_call", func: "cs2_str_slice", args: [arr, startExpr, endExpr], returnType: I8PTR, type: I8PTR };
  }
  if (arr.type.kind === "array") {
    const elemType = (arr.type as { kind: "array"; element: HIRType }).element;
    const prefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
    const lenFn = `${prefix}_length`;
    const sliceFn = `${prefix}_slice`;
    const startExpr: HIRExpr = startNode
      ? coerceTo(ctx.lowerExpr(startNode), I64)
      : { kind: "literal_i64", value: 0, type: I64 };
    const endExpr: HIRExpr = endNode
      ? coerceTo(ctx.lowerExpr(endNode), I64)
      : { kind: "runtime_call", func: lenFn, args: [arr], returnType: I64, type: I64 };
    return { kind: "runtime_call", func: sliceFn, args: [arr, startExpr, endExpr], returnType: arr.type, type: arr.type };
  }
  throw new Error(`slice on unsupported type: ${arr.type.kind}`);
}

function lowerSubscript(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const arr = ctx.lowerExpr(node.namedChild(0)!);
  const idxNode = node.namedChild(1)!;

  if (idxNode.type === "slice") {
    return lowerSlice(arr, idxNode, ctx);
  }

  const idx = ctx.lowerExpr(idxNode);
  if (arr.type.kind === "array") {
    return { kind: "index_get", array: arr, index: coerceTo(idx, I64), type: arr.type.element };
  }
  if (arr.type.kind === "map") {
    const mt = arr.type as { kind: "map"; key: HIRType; value: HIRType };
    const prefix = mapPrefix(mt.key, mt.value);
    return {
      kind: "runtime_call",
      func: `${prefix}_get`,
      args: [arr, coerceTo(idx, mt.key)],
      returnType: mt.value,
      type: mt.value,
    };
  }
  if (arr.type.kind === "ptr") {
    const pt = (arr.type as { kind: "ptr"; pointee: string }).pointee;
    if (pt === "__counter_num")
      return { kind: "runtime_call", func: "cs2_counter_num_get", args: [arr, coerceToF64(idx)], returnType: I64, type: I64 };
    if (pt === "__counter_str")
      return { kind: "runtime_call", func: "cs2_counter_str_get", args: [arr, coerceTo(idx, I8PTR)], returnType: I64, type: I64 };
    if (pt === "__deque_num")
      return { kind: "runtime_call", func: "cs2_deque_num_get", args: [arr, coerceTo(idx, I64)], returnType: I64, type: I64 };
  }

  if (arr.type.kind === "i8ptr") {
    return {
      kind: "runtime_call",
      func: "cs2_str_char_at",
      args: [arr, coerceTo(idx, I64)],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  throw new Error(`subscript on unsupported type: ${arr.type.kind}`);
}

function lowerAttribute(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const objNode = node.namedChild(0)!;
  const fieldName = node.namedChild(1)!.text;

  if (objNode.text === "math") {
    switch (fieldName) {
      case "pi": return { kind: "literal_f64", value: Math.PI, type: F64 };
      case "e": return { kind: "literal_f64", value: Math.E, type: F64 };
      case "inf": return { kind: "literal_f64", value: Infinity, type: F64 };
      case "tau": return { kind: "literal_f64", value: 2 * Math.PI, type: F64 };
    }
  }

  if (objNode.text === "sys") {
    const strArrType: HIRType = { kind: "array", element: I8PTR };
    switch (fieldName) {
      case "argv":
        return { kind: "runtime_call", func: "cs2_py_sys_argv", args: [], returnType: strArrType, type: strArrType };
    }
  }

  if (objNode.text === "os" && fieldName === "path") {
    return { kind: "literal_null", type: VOID };
  }

  const obj = ctx.lowerExpr(objNode);

  if (obj.type.kind === "ptr") {
    const cls = ctx.classes.get(obj.type.pointee);
    if (cls) {
      const fieldIdx = cls.fields.findIndex((f) => f.name === fieldName);
      if (fieldIdx >= 0) {
        return {
          kind: "field_get",
          object: obj,
          fieldName,
          index: fieldIdx,
          type: cls.fields[fieldIdx].type,
        };
      }
    }
  }
  throw new Error(`unknown attribute: ${fieldName} on ${obj.type.kind}`);
}

function lowerDictLiteral(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const entries: { key: HIRExpr; value: HIRExpr }[] = [];
  let keyType: HIRType = I8PTR;
  let valType: HIRType = I8PTR;

  for (let i = 0; i < node.namedChildCount; i++) {
    const pair = node.namedChild(i)!;
    if (pair.type !== "pair") continue;
    const k = ctx.lowerExpr(pair.namedChild(0)!);
    const v = ctx.lowerExpr(pair.namedChild(1)!);
    if (i === 0) {
      keyType = k.type.kind === "i64" ? F64 : k.type;
      valType = v.type;
    }
    entries.push({ key: coerceTo(k, keyType), value: coerceTo(v, valType) });
  }

  const mapType: HIRType = { kind: "map", key: keyType, value: valType };
  return { kind: "alloc_map", keyType, valueType: valType, entries, type: mapType };
}

function lowerTupleLiteral(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const elems = namedChildren(node).map((c) => ctx.lowerExpr(c));
  if (elems.length === 0) {
    return { kind: "alloc_array", elementType: F64, initialValues: [], type: { kind: "array", element: F64 } };
  }
  const elemType = elems[0].type.kind === "i64" ? F64 : elems[0].type;
  return {
    kind: "alloc_array",
    elementType: elemType,
    initialValues: elems.map((e) => coerceTo(e, elemType)),
    type: { kind: "array", element: elemType },
  };
}

function lowerListCompEnumerate(
  loopVarNode: SyntaxNode, callNode: SyntaxNode,
  bodyNode: SyntaxNode, ifClause: SyntaxNode | null, ctx: LowerCtx
): HIRExpr {
  const argsNode = callNode.childForFieldName("arguments")!;
  const iterExpr = ctx.lowerExpr(argsNode.namedChild(0)!);
  if (iterExpr.type.kind !== "array") throw new Error("enumerate() requires array");
  const elemType = iterExpr.type.element;
  const iterPrefix = elemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const arrId = ctx.freshId(); const iId = ctx.freshId(); const elemId = ctx.freshId();
  const arrRef: HIRExpr = { kind: "local_get", id: arrId, type: iterExpr.type };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  let idxName: string | null = null; let valName: string | null = null;
  if (loopVarNode.type === "pattern_list") {
    const names = namedChildren(loopVarNode).map((c) => c.text);
    idxName = names[0] ?? null; valName = names[1] ?? null;
  } else { idxName = loopVarNode.text; }
  if (idxName) ctx.locals.set(idxName, { id: iId, name: idxName, type: I64 });
  if (valName) ctx.locals.set(valName, { id: elemId, name: valName, type: elemType });

  const savedLocals = new Map(ctx.locals); const savedPending = ctx.pendingStmts;
  ctx.pendingStmts = [];
  const typeCheckExpr = ctx.lowerExpr(bodyNode);
  const resultElemType: HIRType = typeCheckExpr.type;
  ctx.locals = savedLocals; ctx.pendingStmts = savedPending;
  if (idxName) ctx.locals.set(idxName, { id: iId, name: idxName, type: I64 });
  if (valName) ctx.locals.set(valName, { id: elemId, name: valName, type: elemType });

  const resultType: HIRType = { kind: "array", element: resultElemType };
  const arrPrefix = resultElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
  const resultId = ctx.freshId(); const resultName = `__cr${resultId}`;
  ctx.locals.set(resultName, { id: resultId, name: resultName, type: resultType });
  const resultRef: HIRExpr = { kind: "local_get", id: resultId, type: resultType };

  const bodyExpr = ctx.lowerExpr(bodyNode);
  const pushStmt: HIRStmt = { kind: "expr", expr: { kind: "runtime_call", func: `${arrPrefix}_push`,
    args: [resultRef, coerceTo(bodyExpr, resultElemType)], returnType: VOID, type: VOID } };
  const elemLetStmt: HIRStmt = { kind: "let", id: elemId, name: valName ?? "__ev", type: elemType,
    init: { kind: "index_get", array: arrRef, index: iRef, type: elemType }, mutable: false };
  let loopBody: HIRStmt[] = valName ? [elemLetStmt] : [];
  if (ifClause) {
    const cond = ctx.lowerExpr(ifClause.namedChild(0)!);
    loopBody.push({ kind: "if", condition: cond, then: [pushStmt], else: undefined });
  } else { loopBody.push(pushStmt); }

  ctx.pendingStmts.push(
    { kind: "let", id: resultId, name: resultName, type: resultType,
      init: { kind: "alloc_array", elementType: resultElemType, initialValues: [], type: resultType }, mutable: false },
    { kind: "let", id: arrId, name: `__earr_${arrId}`, type: iterExpr.type, init: iterExpr, mutable: false },
    { kind: "let", id: iId, name: idxName ?? "__ei", type: I64, init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
    { kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef,
        right: { kind: "runtime_call", func: `${iterPrefix}_length`, args: [arrRef], returnType: I64, type: I64 }, type: I1 },
      update: { kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 }, type: I64 },
      body: loopBody },
  );
  return resultRef;
}

function lowerListCompRange(
  node: SyntaxNode, loopVarNode: SyntaxNode, rangeCall: SyntaxNode,
  bodyNode: SyntaxNode, ifClause: SyntaxNode | null, ctx: LowerCtx
): HIRExpr {
  const args = rangeCall.childForFieldName("arguments")!;
  const rangeArgs: SyntaxNode[] = [];
  for (let i = 0; i < args.namedChildCount; i++) rangeArgs.push(args.namedChild(i)!);
  let start: HIRExpr, end: HIRExpr, step: HIRExpr;
  if (rangeArgs.length === 1) {
    start = { kind: "literal_i64", value: 0, type: I64 };
    end = ctx.lowerExpr(rangeArgs[0]);
    step = { kind: "literal_i64", value: 1, type: I64 };
  } else if (rangeArgs.length === 2) {
    start = ctx.lowerExpr(rangeArgs[0]);
    end = ctx.lowerExpr(rangeArgs[1]);
    step = { kind: "literal_i64", value: 1, type: I64 };
  } else {
    start = ctx.lowerExpr(rangeArgs[0]);
    end = ctx.lowerExpr(rangeArgs[1]);
    step = ctx.lowerExpr(rangeArgs[2]);
  }
  const loopVarName = loopVarNode.text;
  const varId = ctx.freshId();
  ctx.locals.set(loopVarName, { id: varId, name: loopVarName, type: I64 });

  const savedLocals = new Map(ctx.locals);
  const savedPending = ctx.pendingStmts;
  ctx.pendingStmts = [];
  const typeCheckExpr = ctx.lowerExpr(bodyNode);
  const resultElemType: HIRType = typeCheckExpr.type;
  ctx.locals = savedLocals;
  ctx.pendingStmts = savedPending;
  ctx.locals.set(loopVarName, { id: varId, name: loopVarName, type: I64 });

  const resultType: HIRType = { kind: "array", element: resultElemType };
  const arrPrefix = resultElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";
  const resultId = ctx.freshId();
  const resultName = `__cr${resultId}`;
  ctx.locals.set(resultName, { id: resultId, name: resultName, type: resultType });
  const resultRef: HIRExpr = { kind: "local_get", id: resultId, type: resultType };
  const iRef: HIRExpr = { kind: "local_get", id: varId, type: I64 };

  const bodyExpr = ctx.lowerExpr(bodyNode);
  const pushStmt: HIRStmt = {
    kind: "expr",
    expr: { kind: "runtime_call", func: `${arrPrefix}_push`,
      args: [resultRef, coerceTo(bodyExpr, resultElemType)], returnType: VOID, type: VOID },
  };
  let loopBody: HIRStmt[] = [];
  if (ifClause) {
    ctx.locals.set(loopVarName, { id: varId, name: loopVarName, type: I64 });
    const cond = ctx.lowerExpr(ifClause.namedChild(0)!);
    loopBody.push({ kind: "if", condition: cond, then: [pushStmt], else: undefined });
  } else {
    loopBody.push(pushStmt);
  }
  const isNegStep = step.kind === "literal_i64" && (step as any).value < 0;
  const condOp = isNegStep ? "gt" : "lt";

  ctx.pendingStmts.push(
    { kind: "let", id: resultId, name: resultName, type: resultType,
      init: { kind: "alloc_array", elementType: resultElemType, initialValues: [], type: resultType }, mutable: false },
    { kind: "let", id: varId, name: loopVarName, type: I64, init: start, mutable: true },
    { kind: "for",
      condition: { kind: "binary", op: condOp as any, left: iRef, right: end, type: I1 },
      update: { kind: "local_set", id: varId,
        value: { kind: "binary", op: "add", left: iRef, right: step, type: I64 }, type: I64 },
      body: loopBody },
  );
  return resultRef;
}

function lowerListComp(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const bodyNode = node.namedChild(0)!;
  const forClause = node.namedChild(1)!;
  const lastChild = node.namedChild(node.namedChildCount - 1)!;
  const ifClause = lastChild.type === "if_clause" ? lastChild : null;

  const loopVarNode = forClause.namedChild(0)!;
  const iterNode = forClause.namedChild(forClause.namedChildCount - 1)!;
  const loopVarName = loopVarNode.text;

  if (iterNode.type === "call" && iterNode.childForFieldName("function")?.text === "range") {
    return lowerListCompRange(node, loopVarNode, iterNode, bodyNode, ifClause, ctx);
  }
  if (iterNode.type === "call" && iterNode.childForFieldName("function")?.text === "enumerate") {
    return lowerListCompEnumerate(loopVarNode, iterNode, bodyNode, ifClause, ctx);
  }

  const iterExpr = ctx.lowerExpr(iterNode);
  const iterElemType: HIRType = iterExpr.type.kind === "array" ? iterExpr.type.element : F64;
  const iterPrefix = iterElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const savedLocals = new Map(ctx.locals);
  const savedPending = ctx.pendingStmts;
  ctx.pendingStmts = [];
  const tmpVarId = ctx.freshId();
  ctx.locals.set(loopVarName, { id: tmpVarId, name: loopVarName, type: iterElemType });
  const typeCheckExpr = ctx.lowerExpr(bodyNode);
  const resultElemType: HIRType = typeCheckExpr.type;
  ctx.locals = savedLocals;
  ctx.pendingStmts = savedPending;

  const resultType: HIRType = { kind: "array", element: resultElemType };
  const arrPrefix = resultElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const resultId = ctx.freshId();
  const iterArrId = ctx.freshId();
  const iId = ctx.freshId();
  const varId = ctx.freshId();
  const resultName = `__cr${resultId}`;
  const iterArrName = `__ci${iterArrId}`;
  const iName = `__ci2${iId}`;

  ctx.locals.set(resultName, { id: resultId, name: resultName, type: resultType });
  ctx.locals.set(iterArrName, { id: iterArrId, name: iterArrName, type: iterExpr.type });
  ctx.locals.set(iName, { id: iId, name: iName, type: I64 });
  ctx.locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });

  const resultRef: HIRExpr = { kind: "local_get", id: resultId, type: resultType };
  const iterArrRef: HIRExpr = { kind: "local_get", id: iterArrId, type: iterExpr.type };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  const lenExpr: HIRExpr = {
    kind: "runtime_call", func: `${iterPrefix}_length`,
    args: [iterArrRef], returnType: I64, type: I64,
  };

  const bodyExpr = ctx.lowerExpr(bodyNode);
  const pushStmt: HIRStmt = {
    kind: "expr",
    expr: {
      kind: "runtime_call",
      func: `${arrPrefix}_push`,
      args: [resultRef, coerceTo(bodyExpr, resultElemType)],
      returnType: VOID, type: VOID,
    },
  };

  const elemLet: HIRStmt = {
    kind: "let", id: varId, name: loopVarName, type: iterElemType,
    init: { kind: "index_get", array: iterArrRef, index: iRef, type: iterElemType },
    mutable: false,
  };

  let loopBody: HIRStmt[] = [elemLet];
  if (ifClause) {
    ctx.locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });
    const condExpr = ctx.lowerExpr(ifClause.namedChild(0)!);
    loopBody.push({ kind: "if", condition: condExpr, then: [pushStmt], else: undefined });
  } else {
    loopBody.push(pushStmt);
  }

  ctx.pendingStmts.push(
    {
      kind: "let", id: resultId, name: resultName, type: resultType,
      init: { kind: "alloc_array", elementType: resultElemType, initialValues: [], type: resultType },
      mutable: false,
    },
    {
      kind: "let", id: iterArrId, name: iterArrName, type: iterExpr.type,
      init: iterExpr, mutable: false,
    },
    {
      kind: "let", id: iId, name: iName, type: I64,
      init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true,
    },
    {
      kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
      update: {
        kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
        type: I64,
      },
      body: loopBody,
    }
  );

  return resultRef;
}

function lowerDictComp(node: SyntaxNode, ctx: LowerCtx): HIRExpr {
  const pairNode = node.namedChild(0)!;
  const keyNode = pairNode.type === "pair" ? pairNode.namedChild(0)! : pairNode;
  const valNode = pairNode.type === "pair" ? pairNode.namedChild(1)! : node.namedChild(1)!;
  const lastChild = node.namedChild(node.namedChildCount - 1)!;
  const ifClause = lastChild.type === "if_clause" ? lastChild : null;
  const forClause = node.namedChild(1)!;
  const actualFor = ifClause ? node.namedChild(node.namedChildCount - 2)! : forClause;

  const loopVarNode = actualFor.namedChild(0)!;
  const iterNode = actualFor.namedChild(actualFor.namedChildCount - 1)!;
  const loopVarName = loopVarNode.text;

  const iterExpr = ctx.lowerExpr(iterNode);
  const iterElemType: HIRType = iterExpr.type.kind === "array" ? iterExpr.type.element : F64;
  const iterPrefix = iterElemType.kind === "i8ptr" ? "cs2_str_array" : "cs2_num_array";

  const savedLocals = new Map(ctx.locals);
  const savedPending = ctx.pendingStmts;
  ctx.pendingStmts = [];
  const tmpId = ctx.freshId();
  ctx.locals.set(loopVarName, { id: tmpId, name: loopVarName, type: iterElemType });
  const typeKeyExpr = ctx.lowerExpr(keyNode);
  const typeValExpr = ctx.lowerExpr(valNode);
  const keyType: HIRType = typeKeyExpr.type.kind === "i64" ? F64 : typeKeyExpr.type;
  const valType: HIRType = typeValExpr.type;
  ctx.locals = savedLocals;
  ctx.pendingStmts = savedPending;

  const mapType: HIRType = { kind: "map", key: keyType, value: valType };
  const prefix = mapPrefix(keyType, valType);

  const resultId = ctx.freshId();
  const iterArrId = ctx.freshId();
  const iId = ctx.freshId();
  const varId = ctx.freshId();
  const resultName = `__dc${resultId}`;
  const iterArrName = `__di${iterArrId}`;
  const iName = `__di2${iId}`;

  ctx.locals.set(resultName, { id: resultId, name: resultName, type: mapType });
  ctx.locals.set(iterArrName, { id: iterArrId, name: iterArrName, type: iterExpr.type });
  ctx.locals.set(iName, { id: iId, name: iName, type: I64 });
  ctx.locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });

  const resultRef: HIRExpr = { kind: "local_get", id: resultId, type: mapType };
  const iterArrRef: HIRExpr = { kind: "local_get", id: iterArrId, type: iterExpr.type };
  const iRef: HIRExpr = { kind: "local_get", id: iId, type: I64 };

  const lenExpr: HIRExpr = {
    kind: "runtime_call", func: `${iterPrefix}_length`,
    args: [iterArrRef], returnType: I64, type: I64,
  };

  const keyExpr = coerceTo(ctx.lowerExpr(keyNode), keyType);
  const valExpr = coerceTo(ctx.lowerExpr(valNode), valType);
  const setStmt: HIRStmt = {
    kind: "expr",
    expr: { kind: "runtime_call", func: `${prefix}_set`, args: [resultRef, keyExpr, valExpr], returnType: VOID, type: VOID },
  };

  const elemLet: HIRStmt = {
    kind: "let", id: varId, name: loopVarName, type: iterElemType,
    init: { kind: "index_get", array: iterArrRef, index: iRef, type: iterElemType },
    mutable: false,
  };

  const loopBody: HIRStmt[] = [elemLet];
  if (ifClause) {
    ctx.locals.set(loopVarName, { id: varId, name: loopVarName, type: iterElemType });
    const condExpr = ctx.lowerExpr(ifClause.namedChild(0)!);
    loopBody.push({ kind: "if", condition: condExpr, then: [setStmt], else: undefined });
  } else {
    loopBody.push(setStmt);
  }

  ctx.pendingStmts.push(
    { kind: "let", id: resultId, name: resultName, type: mapType,
      init: { kind: "alloc_map", keyType, valueType: valType, entries: [], type: mapType }, mutable: false },
    { kind: "let", id: iterArrId, name: iterArrName, type: iterExpr.type, init: iterExpr, mutable: false },
    { kind: "let", id: iId, name: iName, type: I64,
      init: { kind: "literal_i64", value: 0, type: I64 }, mutable: true },
    {
      kind: "for",
      condition: { kind: "binary", op: "lt", left: iRef, right: lenExpr, type: I1 },
      update: { kind: "local_set", id: iId,
        value: { kind: "binary", op: "add", left: iRef, right: { kind: "literal_i64", value: 1, type: I64 }, type: I64 },
        type: I64 },
      body: loopBody,
    }
  );

  return resultRef;
}
