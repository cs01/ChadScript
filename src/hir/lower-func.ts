import type { FunctionDeclaration } from "@swc/core";

import type { HIRFunction, HIRStmt, HIRType, HIRParam } from "./types.js";
import { F64, VOID, BOXED } from "./types.js";
import {
  locals,
  outerLocals,
  capturedIds,
  functionRegistry,
  restParamRegistry,
  freshId,
  nextId,
  setNextId,
  setOuterLocals,
  setCapturedIds,
  setIsModuleScope,
  resolveTypeAnnotation,
  coerce,
  offsetToLine,
  incNextAnonId,
  currentLoweringFn,
  setCurrentLoweringFn,
  currentReturnType,
  setCurrentReturnType,
} from "./lower-state.js";
import { lowerExpr } from "./lower-expr.js";
import { lowerBlock } from "./lower.js";

export function lowerFunctionDecl(decl: FunctionDeclaration): HIRFunction {
  const savedLocals = new Map(locals);
  const savedNextId = nextId;
  const savedFn = currentLoweringFn;
  setCurrentLoweringFn(decl.identifier.value);

  const params: HIRParam[] = [];
  for (const param of decl.params) {
    if (param.pat.type === "RestElement") {
      const arg = (param.pat as any).argument;
      const name = arg.type === "Identifier" ? arg.value : `rest${params.length}`;
      const typeAnn = (param.pat as any).typeAnnotation;
      const type: HIRType = typeAnn
        ? resolveTypeAnnotation(typeAnn)
        : { kind: "array", element: F64 };
      const id = freshId();
      params.push({ id, name, type, isRest: true });
      locals.set(name, { id, type, mutable: false });
    } else if (param.pat.type === "AssignmentPattern") {
      const left = (param.pat as any).left;
      const right = (param.pat as any).right;
      const name = left.type === "Identifier" ? left.value : `p${params.length}`;
      const type = left.typeAnnotation ? resolveTypeAnnotation(left.typeAnnotation) : BOXED;
      const id = freshId();
      const defaultValue = lowerExpr(right);
      params.push({ id, name, type, defaultValue });
      locals.set(name, { id, type, mutable: true });
    } else if (param.pat.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation((param.pat as any).typeAnnotation);
      params.push({ id, name: param.pat.value, type });
      locals.set(param.pat.value, { id, type, mutable: true });
    }
  }

  let returnType = decl.returnType ? resolveTypeAnnotation(decl.returnType) : VOID;
  if (decl.async && returnType.kind !== "promise") {
    returnType = { kind: "promise", inner: returnType };
  }

  const savedRetType = currentReturnType;
  setCurrentReturnType(returnType);
  const body = decl.body ? lowerBlock(decl.body) : [];
  setCurrentReturnType(savedRetType);

  if (returnType.kind === "void") {
    for (const s of body) {
      if (s.kind === "return" && s.value) {
        returnType = s.value.type;
        break;
      }
    }
  }

  functionRegistry.set(decl.identifier.value, { params, returnType });

  const fn: HIRFunction = {
    name: decl.identifier.value,
    params,
    returnType,
    body,
    isAsync: decl.async,
    captures: [],
    line: decl.span ? offsetToLine(decl.span.start) : undefined,
  };

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  setNextId(savedNextId + params.length);
  setCurrentLoweringFn(savedFn);

  return fn;
}

export function lowerArrowOrFnExpr(expr: any, varName: string): HIRFunction {
  const fnName = varName || `__anon_${incNextAnonId()}`;
  const savedLocals = new Map(locals);
  const savedNextId = nextId;
  const savedOuterLocals = outerLocals;
  const savedCapturedIds = capturedIds;
  const savedFn = currentLoweringFn;
  const parentFn = currentLoweringFn ?? undefined;
  setCurrentLoweringFn(fnName);

  setOuterLocals(new Map(savedLocals));
  setCapturedIds(new Set<number>());
  locals.clear();
  let maxOuterId = 0;
  for (const [, v] of outerLocals!) if (v.id >= maxOuterId) maxOuterId = v.id + 1;
  setNextId(maxOuterId);

  const params: HIRParam[] = [];
  for (const p of expr.params) {
    const pat = p.pat || p;
    if (pat.type === "RestElement") {
      const arg = pat.argument;
      const name = arg.type === "Identifier" ? arg.value : `rest${params.length}`;
      const typeAnn = pat.typeAnnotation;
      const type: HIRType = typeAnn
        ? resolveTypeAnnotation(typeAnn)
        : { kind: "array", element: F64 };
      const id = freshId();
      params.push({ id, name, type, isRest: true });
      locals.set(name, { id, type, mutable: false });
      restParamRegistry.set(fnName, params.length - 1);
    } else if (pat.type === "AssignmentPattern") {
      const left = pat.left;
      const right = pat.right;
      const name = left.type === "Identifier" ? left.value : `p${params.length}`;
      const type = left.typeAnnotation ? resolveTypeAnnotation(left.typeAnnotation) : BOXED;
      const id = freshId();
      const defaultValue = lowerExpr(right);
      params.push({ id, name, type, defaultValue });
      locals.set(name, { id, type, mutable: true });
    } else if (pat.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation(pat.typeAnnotation);
      params.push({ id, name: pat.value, type });
      locals.set(pat.value, { id, type, mutable: true });
    }
  }

  let returnType = expr.returnType ? resolveTypeAnnotation(expr.returnType) : VOID;
  if (expr.async && returnType.kind !== "promise") {
    returnType = { kind: "promise", inner: returnType };
  }

  let body: HIRStmt[];
  if (expr.body.type === "BlockStatement") {
    setIsModuleScope(false);
    body = lowerBlock(expr.body);
    setIsModuleScope(true);
  } else {
    const retExpr = lowerExpr(expr.body);
    const innerRet =
      returnType.kind === "promise"
        ? (returnType as { kind: "promise"; inner: any }).inner
        : returnType;
    if (innerRet.kind === "void")
      returnType = expr.async ? { kind: "promise", inner: retExpr.type } : retExpr.type;
    const targetType =
      returnType.kind === "promise"
        ? (returnType as { kind: "promise"; inner: any }).inner
        : returnType;
    body = [{ kind: "return", value: coerce(retExpr, targetType) }];
  }

  const captures = Array.from(capturedIds);

  functionRegistry.set(fnName, { params, returnType });

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  setNextId(savedNextId);
  setOuterLocals(savedOuterLocals);
  setCapturedIds(savedCapturedIds);
  setCurrentLoweringFn(savedFn);

  return {
    name: fnName,
    params,
    returnType,
    body,
    isAsync: expr.async || false,
    captures,
    parentFn,
    line: expr.span ? offsetToLine(expr.span.start) : undefined,
  };
}

export function lowerNestedFunctionDecl(decl: FunctionDeclaration): HIRFunction {
  const savedLocals = new Map(locals);
  const savedNextId = nextId;
  const savedOuterLocals = outerLocals;
  const savedCapturedIds = capturedIds;
  const savedFn = currentLoweringFn;
  const parentFn = currentLoweringFn ?? undefined;
  setCurrentLoweringFn(decl.identifier.value);

  setOuterLocals(new Map(savedLocals));
  setCapturedIds(new Set<number>());
  locals.clear();
  let maxOuterId = 0;
  for (const [, v] of outerLocals!) if (v.id >= maxOuterId) maxOuterId = v.id + 1;
  setNextId(maxOuterId);

  const params: HIRParam[] = [];
  for (const param of decl.params) {
    if (param.pat.type === "RestElement") {
      const arg = (param.pat as any).argument;
      const name = arg.type === "Identifier" ? arg.value : `rest${params.length}`;
      const typeAnn = (param.pat as any).typeAnnotation;
      const type: HIRType = typeAnn
        ? resolveTypeAnnotation(typeAnn)
        : { kind: "array", element: F64 };
      const id = freshId();
      params.push({ id, name, type, isRest: true });
      locals.set(name, { id, type, mutable: false });
      restParamRegistry.set(decl.identifier.value, params.length - 1);
    } else if (param.pat.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation((param.pat as any).typeAnnotation);
      params.push({ id, name: param.pat.value, type });
      locals.set(param.pat.value, { id, type, mutable: true });
    }
  }

  let returnType = decl.returnType ? resolveTypeAnnotation(decl.returnType) : VOID;
  if (decl.async && returnType.kind !== "promise") {
    returnType = { kind: "promise", inner: returnType };
  }

  const savedRetType = currentReturnType;
  setCurrentReturnType(returnType);
  setIsModuleScope(false);
  const body = decl.body ? lowerBlock(decl.body) : [];
  setIsModuleScope(true);
  setCurrentReturnType(savedRetType);

  if (returnType.kind === "void") {
    for (const s of body) {
      if (s.kind === "return" && s.value) {
        returnType = s.value.type;
        break;
      }
    }
  }

  const captures = Array.from(capturedIds);

  functionRegistry.set(decl.identifier.value, { params, returnType });

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  setNextId(savedNextId);
  setOuterLocals(savedOuterLocals);
  setCapturedIds(savedCapturedIds);
  setCurrentLoweringFn(savedFn);

  return {
    name: decl.identifier.value,
    params,
    returnType,
    body,
    isAsync: decl.async,
    captures,
    parentFn,
    line: decl.span ? offsetToLine(decl.span.start) : undefined,
  };
}
