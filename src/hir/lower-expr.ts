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
import { F64, I64, I1, I8PTR, VOID, BOXED, REGEX, DYNOBJ, DYNARRAY } from "./types.js";
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
  setExpectedArrayElementType,
  expectedMapType,
  expectedDeclType,
  setExpectedDeclType,
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
  genericSpecializations,
  mangleGenericName,
  enumRegistry,
  builtinImports,
  sourceFilePath,
  narrowedLocals,
  pendingGenericClasses,
} from "./lower-state.js";

import { lowerArrowOrFnExpr } from "./lower-func.js";
import { resolveTypeArgs, specializeFunction, specializeClass } from "./lower-generic.js";
import {
  lowerProcessCall,
  lowerPathCall,
  lowerFsCall,
  matchCryptoChain,
  lowerBufferStaticCall,
  lowerDateMethodCall,
  lowerBufferMethodCall,
  lowerChildProcessCall,
  ensureHttpTypesRegistered,
  lowerHttpCall,
  lowerHttpServerMethodCall,
  lowerHttpResponseMethodCall,
  lowerMathCall,
  lowerJSONCall,
} from "./lower-stdlib.js";
import {
  lowerStringMethodCall,
  lowerMapMethodCall,
  lowerSetMethodCall,
  lowerRegexMethodCall,
  lowerDynarrayMethodCall,
  lowerArrayMethodCall,
} from "./lower-method-call.js";
import { lowerCall, lowerNewExpr } from "./lower-call.js";
import { lowerMember, drainPendingGenericClasses } from "./lower-member.js";
import {
  lowerClassMethodCall as _lcmc,
  lowerOptionalChain,
  lowerGenericFunctionCall as _lgfc,
  lowerGenericNewExpr as _lgne,
} from "./lower-class-call.js";
export { drainPendingGenericClasses, lowerMember } from "./lower-member.js";
export { lowerClassMethodCall, lowerGenericFunctionCall, lowerGenericNewExpr } from "./lower-class-call.js";

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
    case "ConditionalExpression": {
      const condTest = lowerExpr(expr.test);
      const condThen = lowerExpr(expr.consequent);
      const condElse = lowerExpr(expr.alternate);
      const commonType: HIRType = condThen.type.kind === condElse.type.kind ? condThen.type : BOXED;
      const thenCoerced = condThen.type.kind !== commonType.kind ? coerce(condThen, commonType) : condThen;
      const elseCoerced = condElse.type.kind !== commonType.kind ? coerce(condElse, commonType) : condElse;
      return {
        kind: "conditional",
        condition: condTest,
        then: thenCoerced,
        else: elseCoerced,
        type: commonType,
      };
    }
    case "ArrayExpression":
      return lowerArrayLiteral(expr);
    case "ObjectExpression":
      return lowerObjectLiteral(expr as any);
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
      if (inner.type.kind === "dynobj" && targetType.kind === "boxed") {
        return inner;
      }
      if (
        inner.type.kind === "dynobj" &&
        inner.kind === "runtime_call" &&
        (inner as any).func === "cs2_json_parse_obj" &&
        (targetType.kind === "f64" ||
          targetType.kind === "i64" ||
          targetType.kind === "i8ptr" ||
          targetType.kind === "i1")
      ) {
        const boxed: HIRExpr = {
          kind: "runtime_call",
          func: "cs2_json_parse",
          args: (inner as any).args,
          returnType: BOXED,
          type: BOXED,
        };
        return { kind: "unbox", value: boxed, toType: targetType, type: targetType };
      }
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
    case "TsConstAssertion":
      return lowerExpr((expr as any).expression);
    default:
      if ((expr.type as string) === "NullExpression") {
        return { kind: "literal_null", type: BOXED };
      }
      compileError(`unsupported expression type: ${expr.type}`, (expr as any).span);
  }
}

function lowerNumericLiteral(lit: NumericLiteral): HIRExpr {
  const raw = (lit as any).raw as string | undefined;
  const isFloatLiteral = raw !== undefined && (raw.includes(".") || raw.includes("e") || raw.includes("E"));
  if (!isFloatLiteral && Number.isInteger(lit.value) && Math.abs(lit.value) <= Number.MAX_SAFE_INTEGER) {
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
    const narrowed = narrowedLocals.get(id.value);
    return { kind: "local_get", id: local.id, type: narrowed ?? local.type };
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

  const topLevelFn = functionRegistry.get(id.value);
  if (topLevelFn) {
    return {
      kind: "make_closure",
      funcName: id.value,
      captures: [],
      type: {
        kind: "closure",
        params: topLevelFn.params.map((p) => p.type),
        returnType: topLevelFn.returnType,
      },
    };
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

  if (expr.operator === "in") {
    const key = coerce(lowerExpr(expr.left), I8PTR);
    const obj = lowerExpr(expr.right);
    return {
      kind: "binary",
      op: "ne" as BinaryOp,
      left: {
        kind: "runtime_call",
        func: "cs2_dynobj_tag",
        args: [obj, key],
        returnType: I64,
        type: I64,
      },
      right: { kind: "literal_i64", value: -1, type: I64 },
      type: I1,
    };
  }

  if (expr.operator === "instanceof") {
    const val = lowerExpr(expr.left);
    const className =
      expr.right.type === "Identifier" ? (expr.right as any).value : null;
    if (
      className &&
      val.type.kind === "ptr" &&
      (val.type as { kind: "ptr"; pointee: string }).pointee === className
    ) {
      return { kind: "literal_i1", value: true, type: I1 };
    }
    return { kind: "literal_i1", value: false, type: I1 };
  }

  const isEqOp = expr.operator === "===" || expr.operator === "!==" || expr.operator === "==" || expr.operator === "!=";
  const leftIsMember = expr.left.type === "MemberExpression";
  const rightIsMember = expr.right.type === "MemberExpression";
  const leftIsString = expr.left.type === "StringLiteral";
  const rightIsString = expr.right.type === "StringLiteral";

  let left: HIRExpr;
  let right: HIRExpr;
  if (isEqOp && leftIsMember && rightIsString) {
    setExpectedDeclType(I8PTR);
    left = lowerExpr(expr.left);
    setExpectedDeclType(null);
    right = lowerExpr(expr.right);
  } else if (isEqOp && rightIsMember && leftIsString) {
    left = lowerExpr(expr.left);
    setExpectedDeclType(I8PTR);
    right = lowerExpr(expr.right);
    setExpectedDeclType(null);
  } else {
    left = lowerExpr(expr.left);
    right = lowerExpr(expr.right);
  }
  const op = mapBinaryOp(expr.operator);

  if (left.type.kind === "dynobj" || right.type.kind === "dynobj") {
    if (left.type.kind === "dynobj") left = coerce(left, BOXED);
    if (right.type.kind === "dynobj") right = coerce(right, BOXED);
  }

  if (op === "and" || op === "or") {
    if (left.type.kind === "boxed" || right.type.kind === "boxed") {
      if (left.type.kind !== "boxed") left = coerce(left, BOXED);
      if (right.type.kind !== "boxed") right = coerce(right, BOXED);
      return { kind: "binary", op, left, right, type: BOXED };
    }
    if (left.type.kind === right.type.kind) {
      return { kind: "binary", op, left, right, type: left.type };
    }
    left = coerce(left, BOXED);
    right = coerce(right, BOXED);
    return { kind: "binary", op, left, right, type: BOXED };
  }

  if (left.type.kind === "boxed" || right.type.kind === "boxed") {
    if (left.type.kind !== "boxed") left = coerce(left, BOXED);
    if (right.type.kind !== "boxed") right = coerce(right, BOXED);
    const isComparison = op === "eq" || op === "ne" || op === "lt" || op === "le" || op === "gt" || op === "ge";
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
  if ((op === "eq" || op === "ne") &&
    ((left.type.kind === "dynobj" && right.type.kind === "i8ptr") ||
     (left.type.kind === "i8ptr" && right.type.kind === "dynobj"))) {
    const l = left.type.kind === "dynobj" ? { ...left, type: I8PTR } : left;
    const r = right.type.kind === "dynobj" ? { ...right, type: I8PTR } : right;
    return { kind: "binary", op: op === "eq" ? "str_eq" : "str_ne", left: l, right: r, type: I1 };
  }

  if (BITWISE_OPS.has(op)) {
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

  const isComparison = op === "eq" || op === "ne" || op === "lt" || op === "le" || op === "gt" || op === "ge";
  const resultType = isComparison ? I1 : operandType;

  return { kind: "binary", op, left, right, type: resultType };
}

function lowerBinaryWithOp(op: BinaryOp, left: HIRExpr, right: HIRExpr): HIRExpr {
  if (op === "add" && (left.type.kind === "i8ptr" || right.type.kind === "i8ptr")) {
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [left, right],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  if (BITWISE_OPS.has(op)) {
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
  if (expr.operator === "delete" && (expr.argument as any).type === "MemberExpression") {
    const member = expr.argument as MemberExpression;
    const obj = lowerExpr(member.object);
    if (
      (obj.type.kind === "dynobj" || obj.type.kind === "boxed") &&
      member.property.type === "Identifier"
    ) {
      const dynObj = obj.type.kind === "boxed" ? coerce(obj, DYNOBJ) : obj;
      const key: HIRExpr = { kind: "literal_string", value: (member.property as Identifier).value, type: I8PTR };
      return { kind: "runtime_call", func: "cs2_dynobj_delete", args: [dynObj, key], returnType: VOID, type: VOID };
    }
    return { kind: "literal_i1", value: true, type: I1 };
  }
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
  if (arg.kind === "field_get") {
    return {
      kind: "field_set",
      object: arg.object,
      fieldName: arg.fieldName,
      index: arg.index,
      value: newVal,
      type: arg.type,
    } as HIRExpr;
  }
  if (arg.kind === "index_get") {
    return {
      kind: "index_set",
      object: arg.object,
      index: (arg as any).index,
      value: newVal,
      type: arg.type,
    } as HIRExpr;
  }
  if (arg.kind !== "local_get") {
    throw new Error("update expression on unsupported target: " + arg.kind);
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
          const fieldIdx = classInfo.fields.findIndex((f) => f.name === (member.property as any).value);
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
      if (obj.type.kind === "map") {
        const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
        const prefix = mapPrefix(mt.key, mt.value);
        return {
          kind: "runtime_call",
          func: `${prefix}_set`,
          args: [obj, coerce(index, mt.key), coerce(value, mt.value)],
          returnType: VOID,
          type: VOID,
        };
      }
      if (obj.type.kind === "ptr") {
        const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
        if (pointee === "Uint8Array" || pointee === "Float64Array") {
          const fn = pointee === "Uint8Array" ? "cs2_uint8array_set" : "cs2_float64array_set";
          return {
            kind: "runtime_call",
            func: fn,
            args: [obj, coerce(index, F64), coerce(value, F64)],
            returnType: F64,
            type: F64,
          };
        }
      }
      if (obj.type.kind === "dynobj" || obj.type.kind === "boxed") {
        const dynObj = obj.type.kind === "boxed" ? coerce(obj, DYNOBJ) : obj;
        const keyStr = index.type.kind !== "i8ptr" ? coerce(index, I8PTR) : index;
        const { func: setFunc, valueType: setValType } = dynobjSetFuncForType(value.type);
        const coercedVal = setValType && value.type.kind !== setValType.kind ? coerce(value, setValType) : value;
        return {
          kind: "runtime_call",
          func: setFunc,
          args: [dynObj, keyStr, coercedVal],
          returnType: VOID,
          type: VOID,
        };
      }
    }
  }

  return value;
}

function dynobjSetFuncForType(t: HIRType): { func: string; valueType: HIRType | null } {
  switch (t.kind) {
    case "f64":
    case "i64":
      return { func: "cs2_dynobj_set_f64", valueType: F64 };
    case "i8ptr":
      return { func: "cs2_dynobj_set_str", valueType: I8PTR };
    case "i1":
      return { func: "cs2_dynobj_set_bool", valueType: I1 };
    case "dynobj":
    case "ptr":
    case "map":
    case "set":
      return { func: "cs2_dynobj_set_obj", valueType: null };
    case "dynarray":
    case "array":
      return { func: "cs2_dynobj_set_arr", valueType: null };
    case "boxed":
      return { func: "cs2_dynobj_set_boxed", valueType: BOXED };
    default:
      return { func: "cs2_dynobj_set_boxed", valueType: BOXED };
  }
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
    const elemTarget = expectedArrayElementType;
    const elements = rawElements.map((e: any) => {
      if (elemTarget && elemTarget.kind === "ptr") setExpectedDeclType(elemTarget);
      if (elemTarget && elemTarget.kind === "array") setExpectedArrayElementType((elemTarget as any).element);
      const result = lowerExpr(e.expression);
      if (elemTarget && elemTarget.kind === "ptr") setExpectedDeclType(null);
      if (elemTarget && elemTarget.kind === "array") setExpectedArrayElementType(elemTarget);
      return result;
    });
    if (!elemTarget && (expectedDeclType?.kind === "boxed" || expectedDeclType?.kind === "dynarray")) {
      const boxedElems = elements.map((e: HIRExpr) => (e.type.kind === "boxed" ? e : coerce(e, BOXED)));
      return {
        kind: "alloc_dynarray",
        initialValues: boxedElems,
        type: DYNARRAY,
      };
    }
    let elementType: HIRType = elemTarget || F64;
    if (!elemTarget && elements.length > 0) {
      if (elements.some((e: HIRExpr) => e.type.kind === "i8ptr")) elementType = I8PTR;
      else if (elements.some((e: HIRExpr) => e.type.kind === "ptr")) elementType = elements[0].type;
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

export const untypedDynObjAccesses: string[] = [];

function dynobj_get(obj: HIRExpr, key: HIRExpr): HIRExpr {
  if (key.kind === "literal_string") {
    untypedDynObjAccesses.push(`.${(key as any).value}`);
  }
  return {
    kind: "runtime_call",
    func: "cs2_dynobj_get_obj",
    args: [obj, key],
    returnType: DYNOBJ,
    type: DYNOBJ,
  };
}

function dynobj_get_typed(obj: HIRExpr, key: HIRExpr, targetType: HIRType | null): HIRExpr {
  if (targetType) {
    switch (targetType.kind) {
      case "f64":
      case "i64":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_f64",
          args: [obj, key],
          returnType: F64,
          type: F64,
        };
      case "i8ptr":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_str",
          args: [obj, key],
          returnType: I8PTR,
          type: I8PTR,
        };
      case "i1":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_bool",
          args: [obj, key],
          returnType: I1,
          type: I1,
        };
      case "dynarray":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_arr",
          args: [obj, key],
          returnType: DYNARRAY,
          type: DYNARRAY,
        };
      case "dynobj":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_obj",
          args: [obj, key],
          returnType: DYNOBJ,
          type: DYNOBJ,
        };
      case "boxed":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_boxed",
          args: [obj, key],
          returnType: BOXED,
          type: BOXED,
        };
      case "map":
      case "set":
      case "ptr":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_obj",
          args: [obj, key],
          returnType: targetType,
          type: targetType,
        };
      case "array":
        return {
          kind: "runtime_call",
          func: "cs2_dynobj_get_boxed",
          args: [obj, key],
          returnType: BOXED,
          type: BOXED,
        };
      default:
        break;
    }
  }
  if (key.kind === "literal_string") {
    untypedDynObjAccesses.push(`.${(key as any).value} (typed fallthrough, target=${targetType?.kind})`);
  }
  return {
    kind: "runtime_call",
    func: "cs2_dynobj_get_boxed",
    args: [obj, key],
    returnType: BOXED,
    type: BOXED,
  };
}

function lowerObjectLiteral(expr: any): HIRExpr {
  if (expectedMapType && expectedMapType.kind === "map") {
    const mt = expectedMapType as { kind: "map"; key: HIRType; value: HIRType };
    const entries: { key: HIRExpr; value: HIRExpr }[] = [];
    let spreadSource: HIRExpr | undefined;
    for (const prop of expr.properties) {
      if (prop.type === "SpreadElement") {
        spreadSource = lowerExpr(prop.arguments);
        continue;
      }
      const keyStr = prop.key.type === "Identifier" ? prop.key.value : prop.key.value;
      const key = coerce({ kind: "literal_string", value: keyStr, type: I8PTR }, mt.key);
      const val = coerce(lowerExpr(prop.value), mt.value);
      entries.push({ key, value: val });
    }
    return {
      kind: "alloc_map",
      keyType: mt.key,
      valueType: mt.value,
      spreadSource,
      entries,
      type: expectedMapType,
    };
  }

  if (expectedDeclType && expectedDeclType.kind === "ptr") {
    const capturedDeclType = expectedDeclType;
    const structName = (capturedDeclType as { kind: "ptr"; pointee: string }).pointee;
    const layout = classRegistry.get(structName) || interfaceRegistry.get(structName);
    if (layout) {
      const propMap = new Map<string, any>();
      for (const prop of expr.properties) {
        if (prop.type === "SpreadElement") continue;
        const key =
          prop.type === "Identifier"
            ? prop.value
            : prop.key.type === "Identifier"
              ? prop.key.value
              : String(prop.key.value);
        propMap.set(key, prop);
      }
      const fields: HIRExpr[] = layout.fields.map((f: { name: string; type: HIRType }) => {
        const prop = propMap.get(f.name);
        if (!prop) return defaultValue(f.type);
        const propVal = prop.type === "Identifier" ? prop : prop.value;
        if (f.type.kind === "array") {
          setExpectedArrayElementType((f.type as any).element);
        } else if (f.type.kind === "ptr") {
          setExpectedDeclType(f.type);
        }
        const valExpr = lowerExpr(propVal);
        if (f.type.kind === "array") setExpectedArrayElementType(null);
        else if (f.type.kind === "ptr") setExpectedDeclType(null);
        return coerce(valExpr, f.type);
      });
      return {
        kind: "alloc_struct",
        structName,
        fields,
        type: capturedDeclType,
      };
    }
  }

  const props: { key: string; value: HIRExpr }[] = [];
  let spreadSource: HIRExpr | undefined;
  for (const prop of expr.properties) {
    if (prop.type === "SpreadElement") {
      spreadSource = lowerExpr(prop.arguments);
      continue;
    }
    if (prop.type === "Identifier") {
      const value = lowerExpr(prop);
      props.push({ key: prop.value, value });
      continue;
    }
    const keyNode = prop.key;
    const keyStr =
      keyNode.type === "Identifier"
        ? keyNode.value
        : keyNode.type === "StringLiteral"
          ? keyNode.value
          : keyNode.type === "NumericLiteral"
            ? String(keyNode.value)
            : String(keyNode.value);
    const value = lowerExpr(prop.value);
    props.push({ key: keyStr, value });
  }
  const propTypes = props.map((p) => ({ name: p.key, type: p.value.type }));
  return {
    kind: "alloc_dynobj",
    props,
    spreadSource,
    type: { kind: "dynobj" as const, props: propTypes },
  };
}

