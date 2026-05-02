import type { CallExpression, MemberExpression, Identifier } from "@swc/core";
import type { HIRExpr, HIRType, HIRParam, BinaryOp } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ } from "./types.js";
import { compileError } from "../errors.js";
import {
  locals, classRegistry, interfaceRegistry, functionRegistry,
  expectedDeclType, freshId, coerce, defaultValue, resolveTypeAnnotation,
  genericClassTemplates, mangleGenericName, pendingFunctions, pendingGenericClasses,
} from "./lower-state.js";
import { lowerExpr, lowerMember } from "./lower-expr.js";
import { lowerCall } from "./lower-call.js";
import { specializeFunction, specializeClass, resolveTypeArgs } from "./lower-generic.js";

export function resolveMethod(
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
  for (let i = args.length; i < resolved.fnInfo.params.length; i++) {
    const p = resolved.fnInfo.params[i];
    args.push(p.defaultValue ? coerce(p.defaultValue, p.type) : defaultValue(p.type));
  }

  return {
    kind: "call",
    callee: resolved.fnName,
    args,
    returnType: resolved.fnInfo.returnType,
    type: resolved.fnInfo.returnType,
  };
}

export function lowerOptionalChain(expr: any): HIRExpr {
  const base = expr.base;

  if (base.type === "MemberExpression") {
    const obj = lowerExpr(base.object);
    if (obj.type.kind !== "ptr" && obj.type.kind !== "dynobj" && obj.type.kind !== "boxed" && obj.type.kind !== "i8ptr" && obj.type.kind !== "array" && obj.type.kind !== "dynarray" && obj.type.kind !== "map") {
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

      const syntheticCall: any = { ...base, callee: memberExpr };
      const callResult = lowerCall(syntheticCall);

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

export function lowerGenericFunctionCall(expr: CallExpression): HIRExpr {
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
  for (let i = args.length; i < fnInfo.params.length; i++) {
    const p = fnInfo.params[i];
    args.push(p.defaultValue ? coerce(p.defaultValue, p.type) : defaultValue(p.type));
  }

  return {
    kind: "call",
    callee: mangledName,
    args,
    returnType: fnInfo.returnType,
    type: fnInfo.returnType,
  };
}

export function lowerGenericNewExpr(expr: any): HIRExpr {
  const baseName = expr.callee.value;
  const typeArgs = resolveTypeArgs(expr.typeArguments);
  const mangledName = mangleGenericName(baseName, typeArgs);

  const result = specializeClass(baseName, typeArgs);
  if (result) {
    pendingGenericClasses.push(result);
  }

  const ctorName = `${mangledName}_constructor`;
  const ctorInfo = functionRegistry.get(ctorName);
  if (!ctorInfo) {
    compileError(`failed to specialize generic class '${baseName}'`, expr.span);
  }

  const args: HIRExpr[] = (expr.arguments || []).map((a: any, i: number) => {
    let arg = lowerExpr(a.expression);
    if (ctorInfo.params[i]) {
      arg = coerce(arg, ctorInfo.params[i].type);
    }
    return arg;
  });
  for (let i = args.length; i < ctorInfo.params.length; i++) {
    const p = ctorInfo.params[i];
    args.push(p.defaultValue ? coerce(p.defaultValue, p.type) : defaultValue(p.type));
  }

  const resultType: HIRType = { kind: "ptr", pointee: mangledName };
  return {
    kind: "call",
    callee: ctorName,
    args,
    returnType: resultType,
    type: resultType,
  };
}

