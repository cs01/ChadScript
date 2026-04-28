import type {
  Expression,
  CallExpression,
  MemberExpression,
  NumericLiteral,
  Identifier,
  BinaryExpression,
  UnaryExpression,
  UpdateExpression,
  AssignmentExpression,
} from "@swc/core";

import type { HIRExpr, HIRType, HIRParam, BinaryOp, UnaryOp } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, REGEX } from "./types.js";
import { compileError } from "../errors.js";
import {
  locals,
  globals,
  classRegistry,
  interfaceRegistry,
  functionRegistry,
  restParamRegistry,
  fnAliases,
  pendingFunctions,
  outerLocals,
  capturedIds,
  closureInfoMap,
  currentClassName,
  expectedArrayElementType,
  freshId,
  resolveTypeAnnotation,
  coerce,
  resolveArithType,
  defaultValue,
  mapBinaryOp,
  BITWISE_OPS,
  compoundOpMap,
  arrayPrefix,
  mapPrefix,
  setPrefix,
  genericFunctionTemplates,
  genericClassTemplates,
  mangleGenericName,
  enumRegistry,
} from "./lower-state.js";

import { lowerArrowOrFnExpr } from "./lower-func.js";
import { resolveTypeArgs, specializeFunction, specializeClass } from "./lower-generic.js";

export function lowerExpr(expr: Expression): HIRExpr {
  switch (expr.type) {
    case "NumericLiteral":
      return lowerNumericLiteral(expr);
    case "StringLiteral":
      return {
        kind: "literal_string",
        value: expr.value,
        type: I8PTR,
      };
    case "BooleanLiteral":
      return {
        kind: "literal_i1",
        value: expr.value,
        type: I1,
      };
    case "NullExpression":
    case "NullLiteral":
      return { kind: "literal_null", type: BOXED };
    case "Identifier":
      return lowerIdentifier(expr);
    case "BinaryExpression":
      return lowerBinary(expr);
    case "UnaryExpression":
      return lowerUnary(expr);
    case "UpdateExpression":
      return lowerUpdate(expr);
    case "AssignmentExpression":
      return lowerAssignment(expr);
    case "CallExpression":
      return lowerCall(expr);
    case "MemberExpression":
      return lowerMember(expr);
    case "ParenthesisExpression":
      return lowerExpr(expr.expression);
    case "ConditionalExpression":
      return {
        kind: "conditional",
        condition: lowerExpr(expr.test),
        then: lowerExpr(expr.consequent),
        else: lowerExpr(expr.alternate),
        type: lowerExpr(expr.consequent).type,
      };
    case "ArrayExpression":
      return lowerArrayLiteral(expr);
    case "NewExpression":
      return lowerNewExpr(expr as any);
    case "ThisExpression": {
      const thisLocal = locals.get("this");
      if (!thisLocal) compileError("'this' used outside class", expr.span);
      return { kind: "local_get", id: thisLocal.id, type: thisLocal.type };
    }
    case "TemplateLiteral":
      return lowerTemplateLiteral(expr as any);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return lowerClosureExpr(expr as any);
    case "OptionalChainingExpression":
      return lowerOptionalChain(expr as any);
    case "TsAsExpression": {
      const inner = lowerExpr((expr as any).expression);
      const targetType = resolveTypeAnnotation((expr as any).typeAnnotation);
      if (inner.type.kind === targetType.kind) return inner;
      return coerce(inner, targetType);
    }
    case "TsNonNullExpression":
      return lowerExpr((expr as any).expression);
    case "RegExpLiteral":
      return {
        kind: "runtime_call",
        func: "cs2_regex_new",
        args: [
          { kind: "literal_string", value: (expr as any).pattern, type: I8PTR },
          { kind: "literal_string", value: (expr as any).flags, type: I8PTR },
        ],
        returnType: REGEX,
        type: REGEX,
      };
    case "AwaitExpression": {
      const arg = lowerExpr((expr as any).argument);
      if (arg.type.kind === "promise") {
        const innerType = (arg.type as { kind: "promise"; inner: HIRType }).inner;
        return { kind: "await", value: arg, resolvedType: innerType, type: innerType };
      }
      return arg;
    }
    default:
      compileError(`unsupported expression type: ${expr.type}`, expr.span);
  }
}

function lowerNumericLiteral(lit: NumericLiteral): HIRExpr {
  if (Number.isInteger(lit.value) && Math.abs(lit.value) <= Number.MAX_SAFE_INTEGER) {
    return { kind: "literal_i64", value: lit.value, type: I64 };
  }
  return { kind: "literal_f64", value: lit.value, type: F64 };
}

function lowerIdentifier(id: Identifier): HIRExpr {
  if (id.value === "NaN") return { kind: "literal_f64", value: NaN, type: F64 };
  if (id.value === "Infinity") return { kind: "literal_f64", value: Infinity, type: F64 };
  if (id.value === "undefined") return { kind: "literal_null", type: { kind: "ptr", pointee: "" } };

  const local = locals.get(id.value);
  if (local) {
    return { kind: "local_get", id: local.id, type: local.type };
  }
  if (outerLocals) {
    const outer = outerLocals.get(id.value);
    if (outer) {
      capturedIds.add(outer.id);
      return { kind: "local_get", id: outer.id, type: outer.type };
    }
  }

  const aliasedName = fnAliases.get(id.value);
  if (aliasedName) {
    const closureInfo = closureInfoMap.get(aliasedName);
    if (closureInfo) {
      return {
        kind: "make_closure",
        funcName: aliasedName,
        captures: closureInfo.captures,
        type: { kind: "closure", params: closureInfo.params, returnType: closureInfo.returnType },
      };
    }
    const fnInfo = functionRegistry.get(aliasedName);
    if (fnInfo) {
      return {
        kind: "make_closure",
        funcName: aliasedName,
        captures: [],
        type: {
          kind: "closure",
          params: fnInfo.params.map((p) => p.type),
          returnType: fnInfo.returnType,
        },
      };
    }
  }

  const global = globals.get(id.value);
  if (global) {
    return { kind: "global_get", name: id.value, type: global.type };
  }
  return { kind: "global_get", name: id.value, type: BOXED };
}

export function lowerBinary(expr: BinaryExpression): HIRExpr {
  if (expr.operator === "??") {
    const left = lowerExpr(expr.left);
    const right = lowerExpr(expr.right);
    return { kind: "nullish_coalesce", left, right, type: left.type };
  }

  let left = lowerExpr(expr.left);
  let right = lowerExpr(expr.right);
  const op = mapBinaryOp(expr.operator);

  if (left.type.kind === "boxed" || right.type.kind === "boxed") {
    if (left.type.kind !== "boxed") left = coerce(left, BOXED);
    if (right.type.kind !== "boxed") right = coerce(right, BOXED);
    const isComparison = ["eq", "ne", "lt", "le", "gt", "ge"].includes(op);
    return { kind: "binary", op, left, right, type: isComparison ? I1 : BOXED };
  }

  if (op === "add" && (left.type.kind === "i8ptr" || right.type.kind === "i8ptr")) {
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [left, right],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if ((op === "eq" || op === "ne") && left.type.kind === "i8ptr" && right.type.kind === "i8ptr") {
    return { kind: "binary", op: op === "eq" ? "str_eq" : "str_ne", left, right, type: I1 };
  }

  if (BITWISE_OPS.includes(op)) {
    if (left.type.kind !== "i64") left = coerce(left, I64);
    if (right.type.kind !== "i64") right = coerce(right, I64);
    return { kind: "binary", op, left, right, type: I64 };
  }

  if (op === "div") {
    if (left.type.kind !== "f64") left = coerce(left, F64);
    if (right.type.kind !== "f64") right = coerce(right, F64);
    return { kind: "binary", op, left, right, type: F64 };
  }

  if (op === "and" || op === "or") {
    return { kind: "binary", op, left, right, type: I1 };
  }

  const operandType = resolveArithType(left.type, right.type);
  if (left.type.kind !== operandType.kind) left = coerce(left, operandType);
  if (right.type.kind !== operandType.kind) right = coerce(right, operandType);

  const isComparison = ["eq", "ne", "lt", "le", "gt", "ge"].includes(op);
  const resultType = isComparison ? I1 : operandType;

  return { kind: "binary", op, left, right, type: resultType };
}

function lowerBinaryWithOp(op: BinaryOp, left: HIRExpr, right: HIRExpr): HIRExpr {
  if (BITWISE_OPS.includes(op)) {
    if (left.type.kind !== "i64") left = coerce(left, I64);
    if (right.type.kind !== "i64") right = coerce(right, I64);
    return { kind: "binary", op, left, right, type: I64 };
  }
  if (op === "div") {
    if (left.type.kind !== "f64") left = coerce(left, F64);
    if (right.type.kind !== "f64") right = coerce(right, F64);
    return { kind: "binary", op, left, right, type: F64 };
  }
  const operandType = resolveArithType(left.type, right.type);
  if (left.type.kind !== operandType.kind) left = coerce(left, operandType);
  if (right.type.kind !== operandType.kind) right = coerce(right, operandType);
  return { kind: "binary", op, left, right, type: operandType };
}

function lowerUnary(expr: UnaryExpression): HIRExpr {
  const operand = lowerExpr(expr.argument);
  let op: UnaryOp;
  switch (expr.operator) {
    case "-":
      op = "neg";
      break;
    case "!":
      op = "not";
      break;
    case "~":
      op = "bit_not";
      break;
    case "typeof":
      op = "typeof";
      break;
    default:
      throw new Error(`unsupported unary operator: ${expr.operator}`);
  }
  const type = op === "not" ? I1 : op === "typeof" ? I8PTR : operand.type;
  return { kind: "unary", op, operand, type };
}

function lowerUpdate(expr: UpdateExpression): HIRExpr {
  const arg = lowerExpr(expr.argument);
  if (arg.kind !== "local_get" && arg.kind !== "global_get") {
    throw new Error("update expression on non-local/global");
  }
  const one: HIRExpr =
    arg.type.kind === "i64"
      ? { kind: "literal_i64", value: 1, type: I64 }
      : { kind: "literal_f64", value: 1, type: F64 };
  const op: BinaryOp = expr.operator === "++" ? "add" : "sub";
  const newVal: HIRExpr = {
    kind: "binary",
    op,
    left: arg,
    right: one,
    type: arg.type,
  };
  if (arg.kind === "global_get") {
    return {
      kind: "global_set",
      name: arg.name,
      value: newVal,
      type: arg.type,
    };
  }
  return {
    kind: "local_set",
    id: arg.id,
    value: newVal,
    type: arg.type,
  };
}

function lowerAssignment(expr: AssignmentExpression): HIRExpr {
  const op = expr.operator;
  let value: HIRExpr;

  if (op !== "=" && expr.left.type === "Identifier") {
    const left = lowerIdentifier(expr.left);
    const right = lowerExpr(expr.right);
    const binOp = compoundOpMap[op];
    if (!binOp) compileError(`unsupported assignment operator: ${op}`, expr.span);
    value = lowerBinaryWithOp(binOp, left, right);
  } else {
    value = lowerExpr(expr.right);
  }

  if (expr.left.type === "Identifier") {
    const local = locals.get(expr.left.value);
    if (local) {
      if (value.type.kind !== local.type.kind) value = coerce(value, local.type);
      return { kind: "local_set", id: local.id, value, type: local.type };
    }
    if (outerLocals) {
      const outer = outerLocals.get(expr.left.value);
      if (outer) {
        capturedIds.add(outer.id);
        if (value.type.kind !== outer.type.kind) value = coerce(value, outer.type);
        return { kind: "local_set", id: outer.id, value, type: outer.type };
      }
    }
    const global = globals.get(expr.left.value);
    if (global) {
      if (value.type.kind !== global.type.kind) value = coerce(value, global.type);
      return { kind: "global_set", name: expr.left.value, value, type: global.type };
    }
    return { kind: "global_set", name: expr.left.value, value, type: value.type };
  }

  if (expr.left.type === "MemberExpression") {
    const member = expr.left as MemberExpression;

    if (member.property.type === "Identifier") {
      const obj = lowerExpr(member.object);
      if (obj.type.kind === "ptr") {
        const className = (obj.type as { kind: "ptr"; pointee: string }).pointee;
        const classInfo = classRegistry.get(className);
        if (classInfo) {
          const fieldIdx = classInfo.fields.findIndex((f) => f.name === member.property.value);
          if (fieldIdx >= 0) {
            const field = classInfo.fields[fieldIdx];
            const coercedValue =
              value.type.kind !== field.type.kind ? coerce(value, field.type) : value;
            return {
              kind: "field_set",
              object: obj,
              fieldName: member.property.value,
              index: fieldIdx,
              value: coercedValue,
              type: field.type,
            };
          }
        }
      }
    }

    if ((member.property as any).type === "Computed") {
      const obj = lowerExpr(member.object);
      const index = lowerExpr((member.property as any).expression);
      if (obj.type.kind === "array") {
        const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
        const coercedValue = value.type.kind !== elemType.kind ? coerce(value, elemType) : value;
        const idxCoerced = index.type.kind !== "i64" ? coerce(index, I64) : index;
        return {
          kind: "index_set",
          array: obj,
          index: idxCoerced,
          value: coercedValue,
          type: elemType,
        };
      }
      if (obj.type.kind === "ptr") {
        const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
        if (pointee === "Uint8Array" || pointee === "Float64Array") {
          const fn =
            pointee === "Uint8Array" ? "cs2_uint8array_set" : "cs2_float64array_set";
          return {
            kind: "runtime_call",
            func: fn,
            args: [obj, coerce(index, F64), coerce(value, F64)],
            returnType: F64,
            type: F64,
          };
        }
      }
    }
  }

  return value;
}

function lowerTemplateLiteral(expr: any): HIRExpr {
  const quasis: any[] = expr.quasis;
  const expressions: any[] = expr.expressions;
  const parts: HIRExpr[] = [];

  for (let i = 0; i < quasis.length; i++) {
    const cooked = quasis[i].cooked;
    if (cooked !== "") {
      parts.push({ kind: "literal_string", value: cooked, type: I8PTR });
    }
    if (i < expressions.length) {
      const e = lowerExpr(expressions[i]);
      parts.push(e);
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

function lowerClosureExpr(expr: any): HIRExpr {
  const fn = lowerArrowOrFnExpr(expr, "");
  pendingFunctions.push(fn);
  fnAliases.set(fn.name, fn.name);

  const closureType: HIRType = {
    kind: "closure",
    params: fn.params.map((p) => p.type),
    returnType: fn.returnType,
  };

  if (fn.captures.length > 0) {
    const captureTypes = fn.captures.map((cid) => {
      for (const [, v] of locals) if (v.id === cid) return v.type;
      if (outerLocals) for (const [, v] of outerLocals) if (v.id === cid) return v.type;
      return F64;
    });
    closureInfoMap.set(fn.name, {
      captures: fn.captures.map((cid, i) => ({ id: cid, type: captureTypes[i] })),
      params: fn.params.map((p) => p.type),
      returnType: fn.returnType,
    });
    return {
      kind: "make_closure",
      funcName: fn.name,
      captures: fn.captures.map((cid, i) => ({ id: cid, type: captureTypes[i] })),
      type: closureType,
    };
  }

  return {
    kind: "make_closure",
    funcName: fn.name,
    captures: [],
    type: closureType,
  };
}

function lowerArrayLiteral(expr: any): HIRExpr {
  const rawElements = (expr.elements || []).filter((e: any) => e !== null);
  const hasSpread = rawElements.some((e: any) => e.spread !== null);

  if (!hasSpread) {
    const elements = rawElements.map((e: any) => lowerExpr(e.expression));
    let elementType: HIRType = expectedArrayElementType || F64;
    if (elements.length > 0) {
      if (elements.some((e: HIRExpr) => e.type.kind === "i8ptr")) elementType = I8PTR;
      else elementType = F64;
    }
    const coercedElements = elements.map((e: HIRExpr) =>
      e.type.kind !== elementType.kind ? coerce(e, elementType) : e,
    );
    return {
      kind: "alloc_array",
      elementType,
      initialValues: coercedElements,
      type: { kind: "array", element: elementType },
    };
  }

  const parsed: { spread: boolean; value: HIRExpr }[] = rawElements.map((e: any) => {
    const lowered = lowerExpr(e.expression);
    return { spread: e.spread !== null, value: lowered };
  });

  let elementType: HIRType = expectedArrayElementType || F64;
  for (const el of parsed) {
    const t =
      el.spread && el.value.type.kind === "array"
        ? (el.value.type as { kind: "array"; element: HIRType }).element
        : el.value.type;
    if (t.kind === "i8ptr") {
      elementType = I8PTR;
      break;
    }
  }

  const coerced: { spread: boolean; value: HIRExpr }[] = parsed.map((el) => {
    if (el.spread) return el;
    return {
      spread: false,
      value: el.value.type.kind !== elementType.kind ? coerce(el.value, elementType) : el.value,
    };
  });

  return {
    kind: "alloc_array_spread",
    elementType,
    elements: coerced as any,
    type: { kind: "array", element: elementType },
  };
}

function lowerCall(expr: CallExpression): HIRExpr {
  if ((expr.callee as any).type === "Super") {
    if (!currentClassName) compileError("super() called outside constructor", expr.span);
    const classInfo = classRegistry.get(currentClassName);
    const parentName = classInfo?.parent;
    if (!parentName) compileError("super() called in class without parent", expr.span);

    const thisLocal = locals.get("this")!;
    const initFnName = `${parentName}_init`;
    const initInfo = functionRegistry.get(initFnName);
    const args: HIRExpr[] = [{ kind: "local_get", id: thisLocal.id, type: thisLocal.type }];
    for (let i = 0; i < expr.arguments.length; i++) {
      let arg = lowerExpr(expr.arguments[i].expression);
      if (initInfo && initInfo.params[i + 1]) {
        arg = coerce(arg, initInfo.params[i + 1].type);
      }
      args.push(arg);
    }
    return { kind: "call", callee: initFnName, args, returnType: VOID, type: VOID };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "console" &&
    expr.callee.property.type === "Identifier"
  ) {
    const method = (expr.callee.property as Identifier).value;
    if (method === "log" || method === "error" || method === "warn") {
      const args = expr.arguments.map((a) => lowerExpr(a.expression));
      const funcMap: Record<string, string> = {
        log: "cs_console_log",
        error: "cs_console_error",
        warn: "cs_console_warn",
      };
      return {
        kind: "runtime_call",
        func: funcMap[method],
        args,
        returnType: VOID,
        type: VOID,
      };
    }
    if (method === "time") {
      const label =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "default", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_console_time",
        args: [label],
        returnType: VOID,
        type: VOID,
      };
    }
    if (method === "timeEnd") {
      const label =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "default", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_console_time_end",
        args: [label],
        returnType: VOID,
        type: VOID,
      };
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "process" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerProcessCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "path" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerPathCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Buffer" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerBufferStaticCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    (expr.callee.object.value === "Uint8Array" ||
      expr.callee.object.value === "Float64Array") &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "from"
  ) {
    const typeName = expr.callee.object.value;
    const arrArg = lowerExpr(expr.arguments[0].expression);
    const resultType: HIRType = { kind: "ptr", pointee: typeName };
    const fn =
      typeName === "Uint8Array"
        ? "cs2_uint8array_from_num_array"
        : "cs2_float64array_from_num_array";
    return {
      kind: "runtime_call",
      func: fn,
      args: [arrArg],
      returnType: resultType,
      type: resultType,
    };
  }

  {
    const cryptoChain = matchCryptoChain(expr);
    if (cryptoChain) return cryptoChain;
  }

  if (
    expr.callee.type === "MemberExpression" &&
    (expr.callee as MemberExpression).object.type === "CallExpression" &&
    ((expr.callee as MemberExpression).object as CallExpression).callee.type ===
      "MemberExpression" &&
    (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression).object
      .type === "Identifier" &&
    (
      (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression)
        .object as Identifier
    ).value === "fs" &&
    (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression)
      .property.type === "Identifier" &&
    (
      (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression)
        .property as Identifier
    ).value === "statSync" &&
    (expr.callee as MemberExpression).property.type === "Identifier"
  ) {
    const innerCall = (expr.callee as MemberExpression).object as CallExpression;
    const pathArg = lowerExpr(innerCall.arguments[0].expression);
    const statMethod = ((expr.callee as MemberExpression).property as Identifier).value;
    switch (statMethod) {
      case "isFile":
        return {
          kind: "runtime_call",
          func: "cs2_fs_stat_is_file",
          args: [pathArg],
          returnType: I1,
          type: I1,
        };
      case "isDirectory":
        return {
          kind: "runtime_call",
          func: "cs2_fs_stat_is_directory",
          args: [pathArg],
          returnType: I1,
          type: I1,
        };
      default:
        throw new Error(`unsupported statSync method: ${statMethod}`);
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "fs" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerFsCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "child_process" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerChildProcessCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "http" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerHttpCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "os" &&
    expr.callee.property.type === "Identifier"
  ) {
    const method = (expr.callee.property as Identifier).value;
    const osMethods: Record<string, { func: string; returnType: HIRType }> = {
      hostname: { func: "cs2_os_hostname", returnType: I8PTR },
      homedir: { func: "cs2_os_homedir", returnType: I8PTR },
      tmpdir: { func: "cs2_os_tmpdir", returnType: I8PTR },
      platform: { func: "cs2_os_platform", returnType: I8PTR },
      arch: { func: "cs2_os_arch", returnType: I8PTR },
      type: { func: "cs2_os_type", returnType: I8PTR },
      uptime: { func: "cs2_os_uptime", returnType: F64 },
    };
    const info = osMethods[method];
    if (info) {
      return { kind: "runtime_call", func: info.func, args: [], returnType: info.returnType, type: info.returnType };
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Math"
  ) {
    return lowerMathCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "JSON" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerJSONCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Promise" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerPromiseStaticCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "String" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "fromCharCode"
  ) {
    const args = expr.arguments.map((a) => coerce(lowerExpr(a.expression), I64));
    return {
      kind: "runtime_call",
      func: "cs2_str_from_char_code",
      args,
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Date" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "now"
  ) {
    return { kind: "runtime_call", func: "cs2_date_now", args: [], returnType: F64, type: F64 };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Number" &&
    expr.callee.property.type === "Identifier"
  ) {
    const method = (expr.callee.property as Identifier).value;
    if (method === "parseInt" || method === "parseFloat") {
      const strArg = coerce(lowerExpr(expr.arguments[0].expression), I8PTR);
      return {
        kind: "runtime_call",
        func: method === "parseInt" ? "cs2_parse_int" : "cs2_parse_float",
        args: [strArg],
        returnType: F64,
        type: F64,
      };
    }
    const arg = coerce(lowerExpr(expr.arguments[0].expression), F64);
    switch (method) {
      case "isInteger":
        return {
          kind: "runtime_call",
          func: "cs2_number_is_integer",
          args: [arg],
          returnType: I1,
          type: I1,
        };
      case "isNaN":
        return {
          kind: "runtime_call",
          func: "cs2_number_is_nan",
          args: [arg],
          returnType: I1,
          type: I1,
        };
      case "isFinite":
        return {
          kind: "runtime_call",
          func: "cs2_number_is_finite",
          args: [arg],
          returnType: I1,
          type: I1,
        };
      default:
        break;
    }
  }

  if (expr.callee.type === "MemberExpression") {
    const obj = lowerExpr(expr.callee.object);
    if (obj.type.kind === "i8ptr") {
      return lowerStringMethodCall(expr, obj);
    }
    if (obj.type.kind === "array") {
      return lowerArrayMethodCall(expr, obj);
    }
    if (obj.type.kind === "map") {
      return lowerMapMethodCall(expr, obj);
    }
    if (obj.type.kind === "set") {
      return lowerSetMethodCall(expr, obj);
    }
    if (obj.type.kind === "regex") {
      return lowerRegexMethodCall(expr, obj);
    }
    if (obj.type.kind === "ptr") {
      const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
      if (pointee === "Buffer") {
        return lowerBufferMethodCall(expr, obj);
      }
      if (pointee === "HttpServer") {
        return lowerHttpServerMethodCall(expr, obj);
      }
      if (pointee === "HttpResponse") {
        return lowerHttpResponseMethodCall(expr, obj);
      }
      if (pointee === "Date") {
        return lowerDateMethodCall(expr, obj);
      }
      return lowerClassMethodCall(expr, obj);
    }
  }

  if (expr.callee.type === "Identifier") {
    const calleeName_ = expr.callee.value;
    if (calleeName_ === "setTimeout" || calleeName_ === "setInterval") {
      const callbackExpr = lowerExpr(expr.arguments[0].expression);
      let delayExpr = lowerExpr(expr.arguments[1].expression);
      if (delayExpr.type.kind !== "f64") delayExpr = coerce(delayExpr, F64);
      const func = calleeName_ === "setTimeout" ? "cs2_set_timeout" : "cs2_set_interval";
      return {
        kind: "runtime_call",
        func,
        args: [callbackExpr, delayExpr],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    if (calleeName_ === "clearTimeout" || calleeName_ === "clearInterval") {
      const handleExpr = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_clear_timer",
        args: [handleExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    if (calleeName_ === "Number") {
      const arg = lowerExpr(expr.arguments[0].expression);
      if (arg.type.kind === "i8ptr") {
        return { kind: "runtime_call", func: "cs2_parse_float", args: [arg], returnType: F64, type: F64 };
      }
      return coerce(arg, F64);
    }
    if (calleeName_ === "String") {
      const arg = lowerExpr(expr.arguments[0].expression);
      if (arg.type.kind === "f64" || arg.type.kind === "i64") {
        return {
          kind: "runtime_call",
          func: "cs2_number_to_string",
          args: [coerce(arg, F64)],
          returnType: I8PTR,
          type: I8PTR,
        };
      }
      return arg;
    }
    if (calleeName_ === "isNaN") {
      return {
        kind: "runtime_call",
        func: "cs2_number_is_nan",
        args: [coerce(lowerExpr(expr.arguments[0].expression), F64)],
        returnType: I1,
        type: I1,
      };
    }
    if (calleeName_ === "isFinite") {
      return {
        kind: "runtime_call",
        func: "cs2_number_is_finite",
        args: [coerce(lowerExpr(expr.arguments[0].expression), F64)],
        returnType: I1,
        type: I1,
      };
    }
    if (calleeName_ === "parseFloat") {
      return {
        kind: "runtime_call",
        func: "cs2_parse_float",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: F64,
        type: F64,
      };
    }
    if (calleeName_ === "parseInt") {
      return {
        kind: "runtime_call",
        func: "cs2_parse_int",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: F64,
        type: F64,
      };
    }
    if (calleeName_ === "fetch") {
      return {
        kind: "runtime_call",
        func: "cs2_fetch_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    if (calleeName_ === "execSync") {
      return {
        kind: "runtime_call",
        func: "cs2_exec_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    }

    if (
      genericFunctionTemplates.has(expr.callee.value) &&
      (expr as any).typeArguments?.params?.length
    ) {
      return lowerGenericFunctionCall(expr);
    }

    const local = locals.get(expr.callee.value);
    if (local && local.type.kind === "closure") {
      const closureType = local.type as { kind: "closure"; params: HIRType[]; returnType: HIRType };
      const args = expr.arguments.map((a, i) => {
        let arg = lowerExpr(a.expression);
        if (closureType.params[i]) arg = coerce(arg, closureType.params[i]);
        return arg;
      });
      return {
        kind: "call_closure",
        callee: { kind: "local_get", id: local.id, type: local.type },
        args,
        returnType: closureType.returnType,
        type: closureType.returnType,
      };
    }

    const globalInfo = globals.get(expr.callee.value);
    if (globalInfo && globalInfo.type.kind === "closure") {
      const closureType = globalInfo.type as {
        kind: "closure";
        params: HIRType[];
        returnType: HIRType;
      };
      const args = expr.arguments.map((a, i) => {
        let arg = lowerExpr(a.expression);
        if (closureType.params[i]) arg = coerce(arg, closureType.params[i]);
        return arg;
      });
      return {
        kind: "call_closure",
        callee: { kind: "global_get", name: expr.callee.value, type: globalInfo.type },
        args,
        returnType: closureType.returnType,
        type: closureType.returnType,
      };
    }

    const calleeName = fnAliases.get(expr.callee.value) || expr.callee.value;
    const fnInfo = functionRegistry.get(calleeName);
    if (!fnInfo) {
      compileError(`call to undeclared function '${expr.callee.value}'`, expr.span);
    }
    const restIdx = restParamRegistry.get(calleeName);
    if (restIdx !== undefined) {
      const args: HIRExpr[] = [];
      for (let i = 0; i < restIdx; i++) {
        let arg = lowerExpr(expr.arguments[i].expression);
        if (fnInfo.params[i]) arg = coerce(arg, fnInfo.params[i].type);
        args.push(arg);
      }
      const restParam = fnInfo.params[restIdx];
      const elemType =
        restParam.type.kind === "array"
          ? (restParam.type as { kind: "array"; element: HIRType }).element
          : F64;
      const restArgs: HIRExpr[] = [];
      for (let i = restIdx; i < expr.arguments.length; i++) {
        let arg = lowerExpr(expr.arguments[i].expression);
        arg = coerce(arg, elemType);
        restArgs.push(arg);
      }
      const restArray: HIRExpr = {
        kind: "alloc_array",
        elementType: elemType,
        initialValues: restArgs,
        type: { kind: "array", element: elemType },
      };
      args.push(restArray);
      return {
        kind: "call",
        callee: calleeName,
        args,
        returnType: fnInfo.returnType,
        type: fnInfo.returnType,
      };
    }
    const args: HIRExpr[] = expr.arguments.map((a, i) => {
      let arg = lowerExpr(a.expression);
      if (fnInfo.params[i]) {
        arg = coerce(arg, fnInfo.params[i].type);
      }
      return arg;
    });
    for (let i = args.length; i < fnInfo.params.length; i++) {
      const p = fnInfo.params[i];
      if (p.defaultValue) {
        args.push(coerce(p.defaultValue, p.type));
      }
    }
    return {
      kind: "call",
      callee: calleeName,
      args,
      returnType: fnInfo.returnType,
      type: fnInfo.returnType,
    };
  }

  compileError(`unsupported call expression: callee is ${expr.callee.type}`, expr.span);
}

function lowerNewExpr(expr: any): HIRExpr {
  if (expr.callee.type !== "Identifier") {
    compileError("new expression requires identifier callee", expr.span);
  }
  const className = expr.callee.value;

  if (className === "RegExp") {
    const patternArg =
      expr.arguments?.length > 0
        ? lowerExpr(expr.arguments[0].expression)
        : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
    const flagsArg =
      expr.arguments?.length > 1
        ? lowerExpr(expr.arguments[1].expression)
        : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
    return {
      kind: "runtime_call",
      func: "cs2_regex_new",
      args: [patternArg, flagsArg],
      returnType: REGEX,
      type: REGEX,
    };
  }

  if (className === "Map" && expr.typeArguments?.params?.length === 2) {
    const keyType = resolveTypeAnnotation(expr.typeArguments.params[0]);
    const valueType = resolveTypeAnnotation(expr.typeArguments.params[1]);
    const prefix = mapPrefix(keyType, valueType);
    const resultType: HIRType = { kind: "map", key: keyType, value: valueType };
    return {
      kind: "runtime_call",
      func: `${prefix}_new`,
      args: [],
      returnType: resultType,
      type: resultType,
    };
  }

  if (className === "Set" && expr.typeArguments?.params?.length === 1) {
    const elemType = resolveTypeAnnotation(expr.typeArguments.params[0]);
    const prefix = setPrefix(elemType);
    const resultType: HIRType = { kind: "set", element: elemType };
    return {
      kind: "runtime_call",
      func: `${prefix}_new`,
      args: [],
      returnType: resultType,
      type: resultType,
    };
  }

  if (className === "Uint8Array") {
    const sizeArg =
      expr.arguments?.length > 0
        ? coerce(lowerExpr(expr.arguments[0].expression), F64)
        : ({ kind: "literal_f64" as const, value: 0, type: F64 } as HIRExpr);
    const resultType: HIRType = { kind: "ptr", pointee: "Uint8Array" };
    return {
      kind: "runtime_call",
      func: "cs2_uint8array_new",
      args: [sizeArg],
      returnType: resultType,
      type: resultType,
    };
  }

  if (className === "Float64Array") {
    const sizeArg =
      expr.arguments?.length > 0
        ? coerce(lowerExpr(expr.arguments[0].expression), F64)
        : ({ kind: "literal_f64" as const, value: 0, type: F64 } as HIRExpr);
    const resultType: HIRType = { kind: "ptr", pointee: "Float64Array" };
    return {
      kind: "runtime_call",
      func: "cs2_float64array_new",
      args: [sizeArg],
      returnType: resultType,
      type: resultType,
    };
  }

  if (className === "Date") {
    const dateType: HIRType = { kind: "ptr", pointee: "Date" };
    if (expr.arguments?.length > 0) {
      const msArg = coerce(lowerExpr(expr.arguments[0].expression), F64);
      return {
        kind: "runtime_call",
        func: "cs2_date_new",
        args: [msArg],
        returnType: dateType,
        type: dateType,
      };
    }
    return {
      kind: "runtime_call",
      func: "cs2_date_new_now",
      args: [],
      returnType: dateType,
      type: dateType,
    };
  }

  if (genericClassTemplates.has(className) && expr.typeArguments?.params?.length) {
    return lowerGenericNewExpr(expr);
  }

  const classInfo = classRegistry.get(className);
  if (!classInfo) {
    compileError(`new expression for unknown class '${className}'`, expr.span);
  }

  const ctorInfo = functionRegistry.get(`${className}_constructor`);
  const args = (expr.arguments || []).map((a: any, i: number) => {
    let arg = lowerExpr(a.expression);
    if (ctorInfo && ctorInfo.params[i]) {
      arg = coerce(arg, ctorInfo.params[i].type);
    }
    return arg;
  });

  const resultType: HIRType = { kind: "ptr", pointee: className };
  return {
    kind: "call",
    callee: `${className}_constructor`,
    args,
    returnType: resultType,
    type: resultType,
  };
}

function lowerProcessCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "exit": {
      const code =
        expr.arguments.length > 0
          ? coerce(lowerExpr(expr.arguments[0].expression), I64)
          : ({ kind: "literal_i64", value: 0, type: I64 } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_process_exit",
        args: [code],
        returnType: VOID,
        type: VOID,
      };
    }
    case "cwd":
      return {
        kind: "runtime_call",
        func: "cs2_process_cwd",
        args: [],
        returnType: I8PTR,
        type: I8PTR,
      };
    default:
      throw new Error(`unsupported process method: ${method}`);
  }
}

function lowerPathCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "join": {
      const args = expr.arguments.map((a) => lowerExpr(a.expression));
      if (args.length === 0) return { kind: "literal_string", value: ".", type: I8PTR };
      if (args.length === 1) return args[0];
      let result: HIRExpr = args[0];
      for (let i = 1; i < args.length; i++) {
        result = {
          kind: "runtime_call",
          func: "cs2_path_join",
          args: [result, args[i]],
          returnType: I8PTR,
          type: I8PTR,
        };
      }
      return result;
    }
    case "resolve": {
      const arg =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_path_resolve",
        args: [arg],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    case "dirname":
      return {
        kind: "runtime_call",
        func: "cs2_path_dirname",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    case "basename":
      return {
        kind: "runtime_call",
        func: "cs2_path_basename",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    case "extname":
      return {
        kind: "runtime_call",
        func: "cs2_path_extname",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    default:
      throw new Error(`unsupported path method: ${method}`);
  }
}

function lowerFsCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "readFileSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_read_file_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    case "writeFileSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_write_file_sync",
        args: [lowerExpr(expr.arguments[0].expression), lowerExpr(expr.arguments[1].expression)],
        returnType: VOID,
        type: VOID,
      };
    case "existsSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_exists_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I1,
        type: I1,
      };
    case "readdirSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_readdir_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: { kind: "array", element: I8PTR },
        type: { kind: "array", element: I8PTR },
      };
    case "mkdirSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_mkdir_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: VOID,
        type: VOID,
      };
    case "unlinkSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_unlink_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: VOID,
        type: VOID,
      };
    case "statSync":
      throw new Error(
        "fs.statSync is not supported directly — use fs.existsSync, or statSync().isFile()/isDirectory() pattern",
      );
    default:
      throw new Error(`unsupported fs method: ${method}`);
  }
}

function matchCryptoChain(expr: CallExpression): HIRExpr | null {
  if (expr.callee.type !== "MemberExpression") return null;
  const outerMember = expr.callee as MemberExpression;
  if (outerMember.property.type !== "Identifier") return null;
  if (outerMember.object.type !== "CallExpression") return null;

  const outerMethod = (outerMember.property as Identifier).value;
  const midCall = outerMember.object as CallExpression;

  if (outerMethod === "toString" && midCall.callee.type === "MemberExpression") {
    const midMember = midCall.callee as MemberExpression;
    if (
      midMember.object.type === "Identifier" &&
      (midMember.object as Identifier).value === "crypto" &&
      midMember.property.type === "Identifier" &&
      (midMember.property as Identifier).value === "randomBytes"
    ) {
      const nArg = lowerExpr(midCall.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_crypto_random_bytes_hex",
        args: [coerce(nArg, F64)],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
  }

  if (outerMethod === "digest" && midCall.callee.type === "MemberExpression") {
    const midMember = midCall.callee as MemberExpression;
    if (
      midMember.property.type === "Identifier" &&
      (midMember.property as Identifier).value === "update" &&
      midMember.object.type === "CallExpression"
    ) {
      const innerCall = midMember.object as CallExpression;
      if (innerCall.callee.type === "MemberExpression") {
        const innerMember = innerCall.callee as MemberExpression;
        if (
          innerMember.object.type === "Identifier" &&
          (innerMember.object as Identifier).value === "crypto" &&
          innerMember.property.type === "Identifier" &&
          (innerMember.property as Identifier).value === "createHash"
        ) {
          const algoArg = lowerExpr(innerCall.arguments[0].expression);
          const dataArg = lowerExpr(midCall.arguments[0].expression);
          const encodingArg = lowerExpr(expr.arguments[0].expression);
          return {
            kind: "runtime_call",
            func: "cs2_crypto_hash",
            args: [algoArg, dataArg, encodingArg],
            returnType: I8PTR,
            type: I8PTR,
          };
        }
      }
    }
  }

  return null;
}

const BUFFER_PTR: HIRType = { kind: "ptr", pointee: "Buffer" };

function lowerBufferStaticCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "from": {
      const strArg = lowerExpr(expr.arguments[0].expression);
      const encoding =
        expr.arguments.length > 1
          ? lowerExpr(expr.arguments[1].expression)
          : ({ kind: "literal_string" as const, value: "utf8", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_buffer_from_string",
        args: [strArg, encoding],
        returnType: BUFFER_PTR,
        type: BUFFER_PTR,
      };
    }
    case "alloc": {
      const sizeArg = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_buffer_alloc",
        args: [coerce(sizeArg, F64)],
        returnType: BUFFER_PTR,
        type: BUFFER_PTR,
      };
    }
    default:
      throw new Error(`unsupported Buffer static method: ${method}`);
  }
}

function lowerDateMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  const dateMethods: Record<string, { func: string; returnType: HIRType }> = {
    getTime: { func: "cs2_date_get_time", returnType: F64 },
    getFullYear: { func: "cs2_date_get_full_year", returnType: F64 },
    getMonth: { func: "cs2_date_get_month", returnType: F64 },
    getDate: { func: "cs2_date_get_date", returnType: F64 },
    getHours: { func: "cs2_date_get_hours", returnType: F64 },
    getMinutes: { func: "cs2_date_get_minutes", returnType: F64 },
    getSeconds: { func: "cs2_date_get_seconds", returnType: F64 },
    getDay: { func: "cs2_date_get_day", returnType: F64 },
    toISOString: { func: "cs2_date_to_iso_string", returnType: I8PTR },
    toString: { func: "cs2_date_to_string", returnType: I8PTR },
    getMilliseconds: { func: "cs2_date_get_milliseconds", returnType: F64 },
    getTimezoneOffset: { func: "cs2_date_get_timezone_offset", returnType: F64 },
    valueOf: { func: "cs2_date_value_of", returnType: F64 },
    toDateString: { func: "cs2_date_to_date_string", returnType: I8PTR },
    toTimeString: { func: "cs2_date_to_time_string", returnType: I8PTR },
  };

  const setMethods: Record<string, string> = {
    setTime: "cs2_date_set_time",
    setFullYear: "cs2_date_set_full_year",
    setMonth: "cs2_date_set_month",
    setDate: "cs2_date_set_date",
    setHours: "cs2_date_set_hours",
    setMinutes: "cs2_date_set_minutes",
    setSeconds: "cs2_date_set_seconds",
  };

  if (Object.hasOwn(setMethods, method)) {
    const arg = coerce(lowerExpr(expr.arguments[0].expression), F64);
    return {
      kind: "runtime_call",
      func: setMethods[method],
      args: [obj, arg],
      returnType: VOID,
      type: VOID,
    };
  }

  const info = dateMethods[method];
  if (!info) compileError(`unsupported Date method: ${method}`, expr.span);

  return {
    kind: "runtime_call",
    func: info.func,
    args: [obj],
    returnType: info.returnType,
    type: info.returnType,
  };
}

function lowerBufferMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "toString": {
      const encoding =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "utf8", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_buffer_to_string",
        args: [obj, encoding],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    default:
      throw new Error(`unsupported Buffer method: ${method}`);
  }
}

function lowerChildProcessCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "execSync":
      return {
        kind: "runtime_call",
        func: "cs2_exec_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    default:
      throw new Error(`unsupported child_process method: ${method}`);
  }
}

const HTTP_SERVER: HIRType = { kind: "ptr", pointee: "HttpServer" };
const HTTP_REQ: HIRType = { kind: "ptr", pointee: "HttpRequest" };
const HTTP_RES: HIRType = { kind: "ptr", pointee: "HttpResponse" };

function ensureHttpTypesRegistered(): void {
  if (!classRegistry.has("HttpRequest")) {
    classRegistry.set("HttpRequest", {
      fields: [
        { name: "method", type: I8PTR },
        { name: "url", type: I8PTR },
      ],
      methods: new Map(),
    });
  }
  if (!classRegistry.has("HttpResponse")) {
    classRegistry.set("HttpResponse", {
      fields: [],
      methods: new Map(),
    });
  }
}

function lowerHttpCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "createServer": {
      ensureHttpTypesRegistered();
      const cbAst = expr.arguments[0].expression as any;
      if (
        cbAst.type === "ArrowFunctionExpression" ||
        cbAst.type === "FunctionExpression"
      ) {
        const params = cbAst.params || [];
        const typeNames = ["HttpRequest", "HttpResponse"];
        for (let i = 0; i < Math.min(params.length, 2); i++) {
          const pat = params[i].pat || params[i];
          if (pat.type === "Identifier") {
            pat.typeAnnotation = {
              type: "TsTypeAnnotation",
              span: pat.span,
              typeAnnotation: {
                type: "TsTypeReference",
                span: pat.span,
                typeName: { type: "Identifier", span: pat.span, value: typeNames[i], optional: false },
              },
            };
          }
        }
      }
      const callbackExpr = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_http_create_server",
        args: [callbackExpr],
        returnType: HTTP_SERVER,
        type: HTTP_SERVER,
      };
    }
    default:
      throw new Error(`unsupported http method: ${method}`);
  }
}

function lowerHttpServerMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "listen": {
      let portExpr = lowerExpr(expr.arguments[0].expression);
      if (portExpr.type.kind !== "f64") portExpr = coerce(portExpr, F64);
      const callbackExpr =
        expr.arguments.length > 1
          ? lowerExpr(expr.arguments[1].expression)
          : ({ kind: "literal_null" as const, type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_http_server_listen",
        args: [obj, portExpr, callbackExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    case "close":
      return {
        kind: "runtime_call",
        func: "cs2_http_server_close",
        args: [obj],
        returnType: VOID,
        type: VOID,
      };
    default:
      throw new Error(`unsupported HttpServer method: ${method}`);
  }
}

function lowerHttpResponseMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "writeHead": {
      let statusExpr = lowerExpr(expr.arguments[0].expression);
      if (statusExpr.type.kind !== "f64") statusExpr = coerce(statusExpr, F64);
      const ctExpr =
        expr.arguments.length > 1
          ? lowerExpr(expr.arguments[1].expression)
          : ({ kind: "literal_string" as const, value: "text/plain", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_http_res_write_head",
        args: [obj, statusExpr, ctExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    case "end": {
      const bodyExpr =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_http_res_end",
        args: [obj, bodyExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    default:
      throw new Error(`unsupported HttpResponse method: ${method}`);
  }
}

function lowerMathCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  switch (method) {
    case "random":
      return {
        kind: "runtime_call",
        func: "cs2_math_random",
        args: [],
        returnType: F64,
        type: F64,
      };
    case "sign":
      return { kind: "runtime_call", func: "cs_math_sign", args, returnType: F64, type: F64 };
    case "clz32":
      return { kind: "runtime_call", func: "cs_math_clz32", args, returnType: F64, type: F64 };
    default: {
      const func = `cs_math_${method}`;
      return { kind: "runtime_call", func, args, returnType: F64, type: F64 };
    }
  }
}

function lowerJSONCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "stringify": {
      const arg = lowerExpr(expr.arguments[0].expression);
      const argType = arg.type;
      let func: string;
      let args: HIRExpr[];

      switch (argType.kind) {
        case "f64":
          func = "cs2_json_stringify_f64";
          args = [arg];
          break;
        case "i64":
          func = "cs2_json_stringify_i64";
          args = [arg];
          break;
        case "i8ptr":
          func = "cs2_json_stringify_str";
          args = [arg];
          break;
        case "i1":
          func = "cs2_json_stringify_bool";
          args = [arg];
          break;
        case "boxed":
          func = "cs2_json_stringify_boxed";
          args = [coerce(arg, BOXED)];
          break;
        case "array": {
          const elemType = (argType as { kind: "array"; element: HIRType }).element;
          switch (elemType.kind) {
            case "f64":
            case "i64":
              func = "cs2_json_stringify_num_array";
              break;
            case "i8ptr":
              func = "cs2_json_stringify_str_array";
              break;
            default:
              throw new Error(
                `unsupported array element type for JSON.stringify: ${elemType.kind}`,
              );
          }
          args = [arg];
          break;
        }
        default:
          throw new Error(`unsupported type for JSON.stringify: ${argType.kind}`);
      }

      return {
        kind: "runtime_call",
        func,
        args,
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    case "parse": {
      let arg = lowerExpr(expr.arguments[0].expression);
      if (arg.type.kind !== "i8ptr") arg = coerce(arg, I8PTR);
      return {
        kind: "runtime_call",
        func: "cs2_json_parse",
        args: [arg],
        returnType: BOXED,
        type: BOXED,
      };
    }
    default:
      compileError(`unsupported JSON method: ${method}`, expr.span);
  }
}

function lowerStringMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  if (method === "match" && args.length >= 1 && args[0].type.kind === "regex") {
    return {
      kind: "runtime_call",
      func: "cs2_string_match",
      args: [obj, args[0]],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (method === "replace" && args.length >= 2 && args[0].type.kind === "regex") {
    return {
      kind: "runtime_call",
      func: "cs2_string_replace_regex",
      args: [obj, args[0], args[1]],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  const strMethodMap: Record<string, { func: string; returnType: HIRType; argTypes?: HIRType[] }> =
    {
      charAt: { func: "cs2_str_char_at", returnType: I8PTR, argTypes: [I64] },
      indexOf: { func: "cs2_str_index_of", returnType: I64, argTypes: [I8PTR] },
      includes: { func: "cs2_str_includes", returnType: I1, argTypes: [I8PTR] },
      startsWith: { func: "cs2_str_starts_with", returnType: I1, argTypes: [I8PTR] },
      endsWith: { func: "cs2_str_ends_with", returnType: I1, argTypes: [I8PTR] },
      slice: { func: "cs2_str_slice", returnType: I8PTR, argTypes: [I64, I64] },
      substring: { func: "cs2_str_substring", returnType: I8PTR, argTypes: [I64, I64] },
      toUpperCase: { func: "cs2_str_to_upper", returnType: I8PTR },
      toLowerCase: { func: "cs2_str_to_lower", returnType: I8PTR },
      trim: { func: "cs2_str_trim", returnType: I8PTR },
      repeat: { func: "cs2_str_repeat", returnType: I8PTR, argTypes: [I64] },
      replace: { func: "cs2_str_replace", returnType: I8PTR, argTypes: [I8PTR, I8PTR] },
      charCodeAt: { func: "cs2_str_char_code_at", returnType: I64, argTypes: [I64] },
      split: {
        func: "cs2_str_split",
        returnType: { kind: "array", element: I8PTR },
        argTypes: [I8PTR],
      },
      padStart: { func: "cs2_str_pad_start", returnType: I8PTR, argTypes: [I64, I8PTR] },
      padEnd: { func: "cs2_str_pad_end", returnType: I8PTR, argTypes: [I64, I8PTR] },
      trimStart: { func: "cs2_str_trim_start", returnType: I8PTR },
      trimEnd: { func: "cs2_str_trim_end", returnType: I8PTR },
      lastIndexOf: { func: "cs2_str_last_index_of", returnType: F64, argTypes: [I8PTR] },
      at: { func: "cs2_str_at", returnType: I8PTR, argTypes: [I64] },
      replaceAll: { func: "cs2_str_replace_all", returnType: I8PTR, argTypes: [I8PTR, I8PTR] },
    };

  const info = strMethodMap[method];
  if (!info) {
    compileError(`unsupported string method: ${method}`, expr.span);
  }

  if ((method === "padStart" || method === "padEnd") && args.length === 1) {
    args.push({ kind: "literal_string", value: " ", type: I8PTR });
  }

  const coercedArgs = info.argTypes ? args.map((a, i) => coerce(a, info.argTypes![i])) : [];

  const bridgeRetType = info.returnType;
  const rtCall: HIRExpr = {
    kind: "runtime_call",
    func: info.func,
    args: [obj, ...coercedArgs],
    returnType: bridgeRetType,
    type: bridgeRetType,
  };

  return rtCall;
}

function lowerMapMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
  const prefix = mapPrefix(mt.key, mt.value);

  switch (method) {
    case "set": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      const val = coerce(lowerExpr(expr.arguments[1].expression), mt.value);
      return {
        kind: "runtime_call",
        func: `${prefix}_set`,
        args: [obj, key, val],
        returnType: VOID,
        type: VOID,
      };
    }
    case "get": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      return {
        kind: "runtime_call",
        func: `${prefix}_get`,
        args: [obj, key],
        returnType: mt.value,
        type: mt.value,
      };
    }
    case "has": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      return {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [obj, key],
        returnType: I1,
        type: I1,
      };
    }
    case "delete": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      return {
        kind: "runtime_call",
        func: `${prefix}_delete`,
        args: [obj, key],
        returnType: I1,
        type: I1,
      };
    }
    case "keys": {
      const keyArrType: HIRType = { kind: "array", element: mt.key };
      return {
        kind: "runtime_call",
        func: `${prefix}_keys`,
        args: [obj],
        returnType: keyArrType,
        type: keyArrType,
      };
    }
    case "values": {
      const valArrType: HIRType = { kind: "array", element: mt.value };
      return {
        kind: "runtime_call",
        func: `${prefix}_values`,
        args: [obj],
        returnType: valArrType,
        type: valArrType,
      };
    }
    case "clear":
      return {
        kind: "runtime_call",
        func: `${prefix}_clear`,
        args: [obj],
        returnType: VOID,
        type: VOID,
      };
    default:
      throw new Error(`unsupported Map method: ${method}`);
  }
}

function lowerSetMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const st = obj.type as { kind: "set"; element: HIRType };
  const prefix = setPrefix(st.element);

  switch (method) {
    case "add": {
      const val = coerce(lowerExpr(expr.arguments[0].expression), st.element);
      return {
        kind: "runtime_call",
        func: `${prefix}_add`,
        args: [obj, val],
        returnType: VOID,
        type: VOID,
      };
    }
    case "has": {
      const val = coerce(lowerExpr(expr.arguments[0].expression), st.element);
      return {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [obj, val],
        returnType: I1,
        type: I1,
      };
    }
    case "delete": {
      const val = coerce(lowerExpr(expr.arguments[0].expression), st.element);
      return {
        kind: "runtime_call",
        func: `${prefix}_delete`,
        args: [obj, val],
        returnType: I1,
        type: I1,
      };
    }
    case "values": {
      const arrType: HIRType = { kind: "array", element: st.element };
      return {
        kind: "runtime_call",
        func: `${prefix}_values`,
        args: [obj],
        returnType: arrType,
        type: arrType,
      };
    }
    case "clear":
      return {
        kind: "runtime_call",
        func: `${prefix}_clear`,
        args: [obj],
        returnType: VOID,
        type: VOID,
      };
    default:
      throw new Error(`unsupported Set method: ${method}`);
  }
}

function lowerRegexMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "test": {
      const strArg = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_regex_test",
        args: [obj, strArg],
        returnType: I1,
        type: I1,
      };
    }
    case "exec": {
      const strArg = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_regex_exec_match",
        args: [obj, strArg],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    default:
      throw new Error(`unsupported RegExp method: ${method}`);
  }
}

function lowerArrayMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));
  const arrType = obj.type as { kind: "array"; element: HIRType };
  const prefix = arrayPrefix(arrType.element);

  type MethodInfo = { func: string; returnType: HIRType; argTypes?: HIRType[] };
  let info: MethodInfo | undefined;

  const isObj = arrType.element.kind === "ptr";
  if (method === "sort" && args.length > 0 && prefix === "cs2_num_array") {
    const callback = args[0];
    return {
      kind: "array_hof",
      array: obj,
      method: "sort" as any,
      callback,
      bridgeFunc: "cs2_num_array_sort_fn",
      returnType: VOID,
      type: VOID,
    };
  }

  if (method === "push") {
    info = { func: `${prefix}_push`, returnType: VOID, argTypes: [arrType.element] };
  } else if (method === "pop") {
    info = { func: `${prefix}_pop`, returnType: arrType.element };
  } else if (method === "join" && !isObj) {
    info = { func: `${prefix}_join`, returnType: I8PTR, argTypes: [I8PTR] };
  } else if (prefix === "cs2_num_array") {
    const numMethods: Record<string, MethodInfo> = {
      indexOf: { func: "cs2_num_array_index_of", returnType: I64, argTypes: [F64] },
      includes: { func: "cs2_num_array_includes", returnType: I64, argTypes: [F64] },
      slice: { func: "cs2_num_array_slice", returnType: obj.type, argTypes: [I64, I64] },
      reverse: { func: "cs2_num_array_reverse", returnType: VOID },
      sort: { func: "cs2_num_array_sort", returnType: VOID },
      concat: { func: "cs2_num_array_concat", returnType: obj.type, argTypes: [obj.type] },
      shift: { func: "cs2_num_array_shift", returnType: F64 },
      unshift: { func: "cs2_num_array_unshift", returnType: VOID, argTypes: [F64] },
      splice: { func: "cs2_num_array_splice", returnType: obj.type, argTypes: [I64, I64] },
      at: { func: "cs2_num_array_at", returnType: F64, argTypes: [I64] },
      fill: { func: "cs2_num_array_fill", returnType: VOID, argTypes: [F64] },
    };
    info = numMethods[method];
  } else if (prefix === "cs2_str_array") {
    const strMethods: Record<string, MethodInfo> = {
      indexOf: { func: "cs2_str_array_index_of", returnType: I64, argTypes: [I8PTR] },
      includes: { func: "cs2_str_array_includes", returnType: I64, argTypes: [I8PTR] },
      slice: { func: "cs2_str_array_slice", returnType: obj.type, argTypes: [I64, I64] },
      reverse: { func: "cs2_str_array_reverse", returnType: VOID },
      concat: { func: "cs2_str_array_concat", returnType: obj.type, argTypes: [obj.type] },
      shift: { func: "cs2_str_array_shift", returnType: I8PTR },
      unshift: { func: "cs2_str_array_unshift", returnType: VOID, argTypes: [I8PTR] },
      at: { func: "cs2_str_array_at", returnType: I8PTR, argTypes: [I64] },
      sort: { func: "cs2_str_array_sort", returnType: VOID },
      fill: { func: "cs2_str_array_fill", returnType: VOID, argTypes: [I8PTR] },
      splice: { func: "cs2_str_array_splice", returnType: obj.type, argTypes: [I64, I64] },
    };
    info = strMethods[method];
  }

  if (
    method === "map" ||
    method === "filter" ||
    method === "forEach" ||
    method === "find" ||
    method === "findIndex" ||
    method === "every" ||
    method === "some" ||
    method === "reduce"
  ) {
    const callback = args[0];
    const hofMethods: Record<string, Record<string, string>> = {
      cs2_num_array: {
        map: "cs2_num_array_map",
        filter: "cs2_num_array_filter",
        forEach: "cs2_num_array_forEach",
        find: "cs2_num_array_find",
        findIndex: "cs2_num_array_findIndex",
        every: "cs2_num_array_every",
        some: "cs2_num_array_some",
        reduce: "cs2_num_array_reduce",
      },
      cs2_str_array: {
        map: "cs2_str_array_map",
        filter: "cs2_str_array_filter",
        forEach: "cs2_str_array_forEach",
        find: "cs2_str_array_find",
        findIndex: "cs2_str_array_findIndex",
        every: "cs2_str_array_every",
        some: "cs2_str_array_some",
        reduce: "cs2_str_array_reduce",
      },
    };
    const funcs = hofMethods[prefix];
    if (!funcs || !funcs[method])
      compileError(`unsupported array method: ${method}`, expr.span);
    let returnType: HIRType;
    switch (method) {
      case "map":
      case "filter":
        returnType = obj.type;
        break;
      case "forEach":
        returnType = VOID;
        break;
      case "find":
        returnType = prefix === "cs2_num_array" ? F64 : I8PTR;
        break;
      case "findIndex":
        returnType = F64;
        break;
      case "every":
      case "some":
        returnType = { kind: "i1" };
        break;
      case "reduce":
        returnType = prefix === "cs2_num_array" ? F64 : I8PTR;
        break;
      default:
        throw new Error(`unexpected hof method: ${method}`);
    }
    const node: any = {
      kind: "array_hof",
      array: obj,
      method,
      callback,
      bridgeFunc: funcs[method],
      returnType,
      type: returnType,
    };
    if (method === "reduce" && args.length > 1) {
      node.initialValue = args[1];
    }
    return node;
  }

  if (!info) compileError(`unsupported array method: ${method}`, expr.span);

  const coercedArgs = info.argTypes ? args.map((a, i) => coerce(a, info!.argTypes![i])) : [];

  const rtCall: HIRExpr = {
    kind: "runtime_call",
    func: info.func,
    args: [obj, ...coercedArgs],
    returnType: info.returnType,
    type: info.returnType,
  };

  if (method === "includes") {
    return {
      kind: "binary",
      op: "ne" as BinaryOp,
      left: rtCall,
      right: { kind: "literal_i64", value: 0, type: I64 },
      type: I1,
    };
  }

  return rtCall;
}

function resolveMethod(
  className: string,
  method: string,
): { fnName: string; fnInfo: { params: HIRParam[]; returnType: HIRType } } | undefined {
  let cls: string | undefined = className;
  while (cls) {
    const fnName = `${cls}_${method}`;
    const fnInfo = functionRegistry.get(fnName);
    if (fnInfo) return { fnName, fnInfo };
    const classInfo = classRegistry.get(cls);
    cls = classInfo?.parent;
  }
  return undefined;
}

export function lowerClassMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const ptrType = obj.type as { kind: "ptr"; pointee: string };
  const typeName = ptrType.pointee;

  const ifaceInfo = interfaceRegistry.get(typeName);
  if (ifaceInfo) {
    const methodIndex = ifaceInfo.methods.findIndex((m) => m.name === method);
    if (methodIndex < 0) {
      compileError(`unknown method '${method}' on interface '${typeName}'`, expr.span);
    }
    const methodDef = ifaceInfo.methods[methodIndex];
    const args: HIRExpr[] = [];
    for (let i = 0; i < expr.arguments.length; i++) {
      let arg = lowerExpr(expr.arguments[i].expression);
      if (methodDef.params[i]) {
        arg = coerce(arg, methodDef.params[i].type);
      }
      args.push(arg);
    }
    return {
      kind: "vtable_call",
      object: obj,
      interfaceName: typeName,
      methodName: method,
      methodIndex,
      args,
      returnType: methodDef.returnType,
      type: methodDef.returnType,
    };
  }

  const resolved = resolveMethod(typeName, method);
  if (!resolved) {
    compileError(`unknown method '${method}' on class '${typeName}'`, expr.span);
  }

  const args: HIRExpr[] = [obj];
  for (let i = 0; i < expr.arguments.length; i++) {
    let arg = lowerExpr(expr.arguments[i].expression);
    if (resolved.fnInfo.params[i + 1]) {
      arg = coerce(arg, resolved.fnInfo.params[i + 1].type);
    }
    args.push(arg);
  }

  return {
    kind: "call",
    callee: resolved.fnName,
    args,
    returnType: resolved.fnInfo.returnType,
    type: resolved.fnInfo.returnType,
  };
}

function lowerOptionalChain(expr: any): HIRExpr {
  const base = expr.base;

  if (base.type === "MemberExpression") {
    const obj = lowerExpr(base.object);
    if (obj.type.kind !== "ptr") {
      compileError("optional chaining requires object type", expr.span);
    }

    const access = lowerMember(base as MemberExpression);
    const nullCond: HIRExpr = {
      kind: "binary",
      op: "eq" as BinaryOp,
      left: obj,
      right: { kind: "literal_null", type: obj.type },
      type: I1,
    };
    return {
      kind: "conditional",
      condition: nullCond,
      then: defaultValue(access.type),
      else: access,
      type: access.type,
    };
  }

  if (base.type === "CallExpression") {
    const callee = base.callee;

    if (callee.type === "OptionalChainingExpression" && callee.base.type === "MemberExpression") {
      const memberExpr = callee.base as MemberExpression;
      const obj = lowerExpr(memberExpr.object);
      if (obj.type.kind !== "ptr") {
        compileError("optional chaining requires object type", expr.span);
      }

      const syntheticCall: any = { ...base, callee: memberExpr };
      const callResult = lowerClassMethodCall(syntheticCall, obj);

      const nullCond: HIRExpr = {
        kind: "binary",
        op: "eq" as BinaryOp,
        left: obj,
        right: { kind: "literal_null", type: obj.type },
        type: I1,
      };
      return {
        kind: "conditional",
        condition: nullCond,
        then: defaultValue(callResult.type),
        else: callResult,
        type: callResult.type,
      };
    }

    return lowerExpr(base);
  }

  compileError(`unsupported optional chaining base: ${base.type}`, expr.span);
}

function lowerGenericFunctionCall(expr: CallExpression): HIRExpr {
  const baseName = (expr.callee as Identifier).value;
  const typeArgs = resolveTypeArgs((expr as any).typeArguments);
  const mangledName = mangleGenericName(baseName, typeArgs);

  const fn = specializeFunction(baseName, typeArgs);
  if (fn) {
    pendingFunctions.push(fn);
  }

  const fnInfo = functionRegistry.get(mangledName);
  if (!fnInfo) {
    compileError(`failed to specialize generic function '${baseName}'`, expr.span);
  }

  const args: HIRExpr[] = expr.arguments.map((a, i) => {
    let arg = lowerExpr(a.expression);
    if (fnInfo.params[i]) {
      arg = coerce(arg, fnInfo.params[i].type);
    }
    return arg;
  });

  return {
    kind: "call",
    callee: mangledName,
    args,
    returnType: fnInfo.returnType,
    type: fnInfo.returnType,
  };
}

function lowerGenericNewExpr(expr: any): HIRExpr {
  const baseName = expr.callee.value;
  const typeArgs = resolveTypeArgs(expr.typeArguments);
  const mangledName = mangleGenericName(baseName, typeArgs);

  const result = specializeClass(baseName, typeArgs);
  if (result) {
    (lowerGenericNewExpr as any).__pendingClasses =
      (lowerGenericNewExpr as any).__pendingClasses || [];
    (lowerGenericNewExpr as any).__pendingClasses.push(result);
  }

  const ctorName = `${mangledName}_constructor`;
  const ctorInfo = functionRegistry.get(ctorName);
  if (!ctorInfo) {
    compileError(`failed to specialize generic class '${baseName}'`, expr.span);
  }

  const args = (expr.arguments || []).map((a: any, i: number) => {
    let arg = lowerExpr(a.expression);
    if (ctorInfo.params[i]) {
      arg = coerce(arg, ctorInfo.params[i].type);
    }
    return arg;
  });

  const resultType: HIRType = { kind: "ptr", pointee: mangledName };
  return {
    kind: "call",
    callee: ctorName,
    args,
    returnType: resultType,
    type: resultType,
  };
}

export function drainPendingGenericClasses(): {
  hirClass: import("./types.js").HIRClass;
  fns: import("./types.js").HIRFunction[];
}[] {
  const pending = (lowerGenericNewExpr as any).__pendingClasses || [];
  (lowerGenericNewExpr as any).__pendingClasses = [];
  return pending;
}

export function lowerMember(expr: MemberExpression): HIRExpr {
  if (
    expr.object.type === "MemberExpression" &&
    (expr.object as MemberExpression).object.type === "Identifier" &&
    ((expr.object as MemberExpression).object as Identifier).value === "process" &&
    (expr.object as MemberExpression).property.type === "Identifier" &&
    ((expr.object as MemberExpression).property as Identifier).value === "env" &&
    expr.property.type === "Identifier"
  ) {
    const envName = (expr.property as Identifier).value;
    return {
      kind: "runtime_call",
      func: "cs2_process_env_get",
      args: [{ kind: "literal_string", value: envName, type: I8PTR }],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (
    expr.object.type === "Identifier" &&
    expr.property.type === "Identifier" &&
    enumRegistry.has(expr.object.value)
  ) {
    const enumName = expr.object.value;
    const memberName = (expr.property as Identifier).value;
    const globalName = `${enumName}_${memberName}`;
    const enumInfo = enumRegistry.get(enumName)!;
    return { kind: "global_get", name: globalName, type: enumInfo.memberType };
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "process" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    switch (prop) {
      case "argv":
        return {
          kind: "runtime_call",
          func: "cs2_process_argv_array",
          args: [],
          returnType: { kind: "array", element: I8PTR },
          type: { kind: "array", element: I8PTR },
        };
      case "platform":
        return {
          kind: "runtime_call",
          func: "cs2_process_platform",
          args: [],
          returnType: I8PTR,
          type: I8PTR,
        };
      case "exit":
        return { kind: "global_get", name: "process_exit", type: BOXED };
      default:
        break;
    }
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "os" &&
    expr.property.type === "Identifier" &&
    (expr.property as Identifier).value === "EOL"
  ) {
    return { kind: "literal_string", value: "\n", type: I8PTR };
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "Math" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    switch (prop) {
      case "PI":
        return { kind: "literal_f64", value: Math.PI, type: F64 };
      case "E":
        return { kind: "literal_f64", value: Math.E, type: F64 };
      case "LN2":
        return { kind: "literal_f64", value: Math.LN2, type: F64 };
      case "LN10":
        return { kind: "literal_f64", value: Math.LN10, type: F64 };
      case "LOG2E":
        return { kind: "literal_f64", value: Math.LOG2E, type: F64 };
      case "LOG10E":
        return { kind: "literal_f64", value: Math.LOG10E, type: F64 };
      case "SQRT2":
        return { kind: "literal_f64", value: Math.SQRT2, type: F64 };
      case "SQRT1_2":
        return { kind: "literal_f64", value: Math.SQRT1_2, type: F64 };
      default:
        throw new Error(`unsupported Math constant: ${prop}`);
    }
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "Number" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    switch (prop) {
      case "MAX_SAFE_INTEGER":
        return { kind: "literal_f64", value: Number.MAX_SAFE_INTEGER, type: F64 };
      case "MIN_SAFE_INTEGER":
        return { kind: "literal_f64", value: Number.MIN_SAFE_INTEGER, type: F64 };
      case "POSITIVE_INFINITY":
        return { kind: "literal_f64", value: Infinity, type: F64 };
      case "NEGATIVE_INFINITY":
        return { kind: "literal_f64", value: -Infinity, type: F64 };
      case "NaN":
        return { kind: "literal_f64", value: NaN, type: F64 };
      case "EPSILON":
        return { kind: "literal_f64", value: Number.EPSILON, type: F64 };
      default:
        throw new Error(`unsupported Number constant: ${prop}`);
    }
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "path" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    if (prop === "sep") {
      return { kind: "literal_string", value: "/", type: I8PTR };
    }
  }

  if ((expr.property as any).type === "Computed") {
    const obj = lowerExpr(expr.object);
    const index = lowerExpr((expr.property as any).expression);
    if (obj.type.kind === "array") {
      const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
      const idxCoerced = index.type.kind !== "i64" ? coerce(index, I64) : index;
      return { kind: "index_get", array: obj, index: idxCoerced, type: elemType };
    }
    if (
      obj.type.kind === "ptr" &&
      (obj.type as { kind: "ptr"; pointee: string }).pointee === "Buffer"
    ) {
      return {
        kind: "runtime_call",
        func: "cs2_buffer_at",
        args: [obj, coerce(index, F64)],
        returnType: F64,
        type: F64,
      };
    }
    if (obj.type.kind === "ptr") {
      const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
      if (pointee === "Uint8Array" || pointee === "Float64Array") {
        const fn =
          pointee === "Uint8Array" ? "cs2_uint8array_get" : "cs2_float64array_get";
        return {
          kind: "runtime_call",
          func: fn,
          args: [obj, coerce(index, F64)],
          returnType: F64,
          type: F64,
        };
      }
    }
    compileError("unsupported computed member access", expr.span);
  }

  if (expr.property.type === "Identifier") {
    const propName = expr.property.value;

    if (propName === "length") {
      const obj = lowerExpr(expr.object);
      if (obj.type.kind === "i8ptr") {
        return {
          kind: "runtime_call",
          func: "cs2_str_length",
          args: [obj],
          returnType: I64,
          type: I64,
        };
      }
      if (obj.type.kind === "array") {
        const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
        const lenFn = `${arrayPrefix(elemType)}_length`;
        return { kind: "runtime_call", func: lenFn, args: [obj], returnType: I64, type: I64 };
      }
      if (
        obj.type.kind === "ptr" &&
        (obj.type as { kind: "ptr"; pointee: string }).pointee === "Buffer"
      ) {
        return {
          kind: "runtime_call",
          func: "cs2_buffer_length",
          args: [obj],
          returnType: F64,
          type: F64,
        };
      }
      if (obj.type.kind === "ptr") {
        const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
        if (pointee === "Uint8Array" || pointee === "Float64Array") {
          const fn =
            pointee === "Uint8Array" ? "cs2_uint8array_length" : "cs2_float64array_length";
          return {
            kind: "runtime_call",
            func: fn,
            args: [obj],
            returnType: F64,
            type: F64,
          };
        }
      }
    }

    if (propName === "size") {
      const obj = lowerExpr(expr.object);
      if (obj.type.kind === "map") {
        const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
        const prefix = mapPrefix(mt.key, mt.value);
        return {
          kind: "runtime_call",
          func: `${prefix}_size`,
          args: [obj],
          returnType: I64,
          type: I64,
        };
      }
      if (obj.type.kind === "set") {
        const st = obj.type as { kind: "set"; element: HIRType };
        const prefix = setPrefix(st.element);
        return {
          kind: "runtime_call",
          func: `${prefix}_size`,
          args: [obj],
          returnType: I64,
          type: I64,
        };
      }
    }

    const obj = lowerExpr(expr.object);
    if (obj.type.kind === "ptr") {
      const typeName = (obj.type as { kind: "ptr"; pointee: string }).pointee;
      if (typeName === "HttpRequest") {
        switch (propName) {
          case "method":
            return {
              kind: "runtime_call",
              func: "cs2_http_req_method",
              args: [obj],
              returnType: I8PTR,
              type: I8PTR,
            };
          case "url":
            return {
              kind: "runtime_call",
              func: "cs2_http_req_url",
              args: [obj],
              returnType: I8PTR,
              type: I8PTR,
            };
          default:
            throw new Error(`unsupported HttpRequest property: ${propName}`);
        }
      }
      const classInfo = classRegistry.get(typeName);
      if (classInfo) {
        const fieldIdx = classInfo.fields.findIndex((f) => f.name === propName);
        if (fieldIdx >= 0) {
          const field = classInfo.fields[fieldIdx];
          return {
            kind: "field_get",
            object: obj,
            fieldName: propName,
            index: fieldIdx,
            type: field.type,
          };
        }
      }
      const ifaceInfo = interfaceRegistry.get(typeName);
      if (ifaceInfo) {
        const fieldIdx = ifaceInfo.fields.findIndex((f) => f.name === propName);
        if (fieldIdx >= 0) {
          const field = ifaceInfo.fields[fieldIdx];
          return {
            kind: "field_get",
            object: obj,
            fieldName: propName,
            index: fieldIdx,
            type: field.type,
          };
        }
      }
    }
  }

  const obj = expr.object.type === "Identifier" ? expr.object.value : expr.object.type;
  const prop = expr.property.type === "Identifier" ? expr.property.value : expr.property.type;
  compileError(`unsupported member access: ${obj}.${prop}`, expr.span);
}

function lowerPromiseStaticCall(expr: CallExpression): HIRExpr {
  const method = ((expr.callee as MemberExpression).property as Identifier).value;
  if (expr.arguments.length < 1) {
    compileError(`Promise.${method} requires an argument`, expr.span);
  }
  const argExpr = expr.arguments[0].expression;
  if (argExpr.type !== "ArrayExpression") {
    compileError(`Promise.${method} requires an array literal argument`, expr.span);
  }
  const elements = (argExpr as any).elements || [];
  const promises: HIRExpr[] = elements
    .filter((e: any) => e !== null)
    .map((e: any) => lowerExpr(e.expression));

  if (promises.length === 0) {
    compileError(`Promise.${method} requires at least one promise`, expr.span);
  }

  const firstType = promises[0].type;
  if (firstType.kind !== "promise") {
    compileError(`Promise.${method} elements must be promises`, expr.span);
  }
  const innerType = (firstType as { kind: "promise"; inner: HIRType }).inner;

  switch (method) {
    case "all":
      return {
        kind: "promise_static",
        method: "all",
        promises,
        innerType,
        type: { kind: "promise", inner: { kind: "array", element: innerType } },
      };
    case "race":
      return {
        kind: "promise_static",
        method: "race",
        promises,
        innerType,
        type: { kind: "promise", inner: innerType },
      };
    case "allSettled": {
      if (!classRegistry.has("__PromiseSettledResult")) {
        const fields =
          innerType.kind === "i8ptr"
            ? [
                { name: "status", type: I8PTR },
                { name: "value", type: I8PTR },
              ]
            : [
                { name: "status", type: I8PTR },
                { name: "value", type: F64 },
              ];
        classRegistry.set("__PromiseSettledResult", {
          fields,
          methods: new Map(),
        });
      }
      const resultStructType: HIRType = { kind: "ptr", pointee: "__PromiseSettledResult" };
      return {
        kind: "promise_static",
        method: "allSettled",
        promises,
        innerType,
        type: { kind: "promise", inner: { kind: "array", element: resultStructType } },
      };
    }
    default:
      compileError(`unsupported Promise method: ${method}`, expr.span);
  }
}
