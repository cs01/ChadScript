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
import { F64, I64, I1, I8PTR, VOID, BOXED } from "./types.js";
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
} from "./lower-state.js";

import { lowerArrowOrFnExpr } from "./lower-func.js";

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

  if (op === "add" && (left.type.kind === "i8ptr" || right.type.kind === "i8ptr")) {
    return {
      kind: "runtime_call",
      func: "cs_string_concat",
      args: [left, right],
      returnType: I8PTR,
      type: I8PTR,
    };
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
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "log"
  ) {
    const args = expr.arguments.map((a) => lowerExpr(a.expression));
    return {
      kind: "runtime_call",
      func: "cs_console_log",
      args,
      returnType: VOID,
      type: VOID,
    };
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

  if (expr.callee.type === "MemberExpression") {
    const obj = lowerExpr(expr.callee.object);
    if (obj.type.kind === "i8ptr") {
      return lowerStringMethodCall(expr, obj);
    }
    if (obj.type.kind === "array") {
      return lowerArrayMethodCall(expr, obj);
    }
    if (obj.type.kind === "ptr") {
      return lowerClassMethodCall(expr, obj);
    }
  }

  if (expr.callee.type === "Identifier") {
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

function lowerMathCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  if (method === "random") {
    return { kind: "runtime_call", func: "cs2_math_random", args: [], returnType: F64, type: F64 };
  }

  const func = `cs_math_${method}`;
  return {
    kind: "runtime_call",
    func,
    args,
    returnType: F64,
    type: F64,
  };
}

function lowerStringMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

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
    };

  const info = strMethodMap[method];
  if (!info) {
    compileError(`unsupported string method: ${method}`, expr.span);
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

  if (
    info.func === "cs2_str_includes" ||
    info.func === "cs2_str_starts_with" ||
    info.func === "cs2_str_ends_with"
  ) {
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

function lowerArrayMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));
  const arrType = obj.type as { kind: "array"; element: HIRType };
  const prefix = arrayPrefix(arrType.element);

  type MethodInfo = { func: string; returnType: HIRType; argTypes?: HIRType[] };
  let info: MethodInfo | undefined;

  const isObj = arrType.element.kind === "ptr";
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
    };
    info = numMethods[method];
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

export function lowerMember(expr: MemberExpression): HIRExpr {
  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "process" &&
    expr.property.type === "Identifier" &&
    expr.property.value === "exit"
  ) {
    return { kind: "global_get", name: "process_exit", type: BOXED };
  }

  if ((expr.property as any).type === "Computed") {
    const obj = lowerExpr(expr.object);
    const index = lowerExpr((expr.property as any).expression);
    if (obj.type.kind === "array") {
      const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
      const idxCoerced = index.type.kind !== "i64" ? coerce(index, I64) : index;
      return { kind: "index_get", array: obj, index: idxCoerced, type: elemType };
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
    }

    const obj = lowerExpr(expr.object);
    if (obj.type.kind === "ptr") {
      const typeName = (obj.type as { kind: "ptr"; pointee: string }).pointee;
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
