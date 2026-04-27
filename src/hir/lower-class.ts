import type { HIRFunction, HIRType, HIRExpr, HIRStmt, HIRParam } from "./types.js";
import { F64, VOID, BOXED } from "./types.js";
import { compileError } from "../errors.js";
import {
  locals,
  classRegistry,
  interfaceRegistry,
  functionRegistry,
  restParamRegistry,
  freshId,
  nextId,
  setNextId,
  setCurrentClassName,
  setIsModuleScope,
  resolveTypeAnnotation,
  defaultValue,
  offsetToLine,
} from "./lower-state.js";
import { lowerExpr } from "./lower-expr.js";
import { lowerBlock } from "./lower.js";

export function registerFunction(decl: any): void {
  const params: HIRParam[] = [];
  let restIndex = -1;
  for (let i = 0; i < decl.params.length; i++) {
    const p = decl.params[i];
    if (p.pat.type === "RestElement") {
      restIndex = i;
      const arg = (p.pat as any).argument;
      const name = arg.type === "Identifier" ? arg.value : `p${i}`;
      const typeAnn = (p.pat as any).typeAnnotation;
      const type = typeAnn
        ? resolveTypeAnnotation(typeAnn)
        : { kind: "array" as const, element: F64 };
      params.push({ id: i, name, type, isRest: true });
    } else if (p.pat.type === "AssignmentPattern") {
      const left = (p.pat as any).left;
      const right = (p.pat as any).right;
      const name = left.type === "Identifier" ? left.value : `p${i}`;
      const type = left.typeAnnotation ? resolveTypeAnnotation(left.typeAnnotation) : BOXED;
      const defaultValue = lowerExpr(right);
      params.push({ id: i, name, type, defaultValue });
    } else {
      const type =
        p.pat.type === "Identifier" ? resolveTypeAnnotation(p.pat.typeAnnotation) : BOXED;
      params.push({ id: i, name: p.pat.type === "Identifier" ? p.pat.value : `p${i}`, type });
    }
  }
  let returnType = decl.returnType ? resolveTypeAnnotation(decl.returnType) : VOID;
  if (decl.async && returnType.kind !== "promise") {
    returnType = { kind: "promise", inner: returnType };
  }
  functionRegistry.set(decl.identifier.value, { params, returnType });
  if (restIndex >= 0) restParamRegistry.set(decl.identifier.value, restIndex);
}

export function registerInterface(decl: any): void {
  const name = decl.id.value;
  const fields: { name: string; type: HIRType }[] = [];
  const methods: { name: string; params: HIRParam[]; returnType: HIRType }[] = [];

  for (const member of decl.body.body) {
    if (member.type === "TsPropertySignature" && member.key?.type === "Identifier") {
      fields.push({
        name: member.key.value,
        type: resolveTypeAnnotation(member.typeAnnotation),
      });
    }
    if (member.type === "TsMethodSignature" && member.key?.type === "Identifier") {
      const params: HIRParam[] = member.params.map((p: any, i: number) => ({
        id: i,
        name: p.pat?.value || p.value || `p${i}`,
        type: resolveTypeAnnotation(p.pat?.typeAnnotation || p.typeAnnotation),
      }));
      const returnType = member.typeAnn ? resolveTypeAnnotation(member.typeAnn) : VOID;
      methods.push({ name: member.key.value, params, returnType });
    }
  }

  interfaceRegistry.set(name, { fields, methods });
}

export function registerClass(decl: any): void {
  const name = decl.identifier.value;
  const parentName = decl.superClass?.type === "Identifier" ? decl.superClass.value : undefined;
  const fields: { name: string; type: HIRType }[] = [];
  const methods = new Map<string, { params: HIRParam[]; returnType: HIRType }>();

  classRegistry.set(name, { fields, methods, parent: parentName });

  if (parentName) {
    const parentInfo = classRegistry.get(parentName);
    if (parentInfo) {
      fields.push(...parentInfo.fields);
      for (const [mName, mInfo] of parentInfo.methods) {
        methods.set(mName, mInfo);
      }
    }
  }

  for (const member of decl.body) {
    if (member.type === "ClassProperty" && member.key?.type === "Identifier") {
      fields.push({
        name: member.key.value,
        type: resolveTypeAnnotation(member.typeAnnotation),
      });
    }
    if (member.type === "ClassMethod" && member.key?.type === "Identifier") {
      const fn = member.function;
      const params: HIRParam[] = fn.params.map((p: any, i: number) => ({
        id: i + 1,
        name: p.pat?.value || `p${i}`,
        type: resolveTypeAnnotation(p.pat?.typeAnnotation),
      }));
      const returnType = fn.returnType ? resolveTypeAnnotation(fn.returnType) : VOID;
      methods.set(member.key.value, { params, returnType });
      functionRegistry.set(`${name}_${member.key.value}`, {
        params: [{ id: 0, name: "this", type: { kind: "ptr", pointee: name } }, ...params],
        returnType,
      });
    }
  }

  classRegistry.set(name, { fields, methods, parent: parentName });
  functionRegistry.set(`${name}_constructor`, {
    params: [],
    returnType: { kind: "ptr", pointee: name },
  });
}

export function lowerClassDecl(decl: any): {
  hirClass: import("./types.js").HIRClass;
  fns: HIRFunction[];
} {
  const name = decl.identifier.value;
  const classInfo = classRegistry.get(name)!;
  const parentName = classInfo.parent;
  const fns: HIRFunction[] = [];

  const hirFields = classInfo.fields.map((f) => ({ name: f.name, type: f.type }));

  for (const member of decl.body) {
    if (member.type === "Constructor") {
      const { constructor, init } = lowerConstructorPair(name, member, classInfo);
      fns.push(init);
      fns.push(constructor);
    }
    if (member.type === "ClassMethod" && member.key?.type === "Identifier") {
      fns.push(lowerMethod(name, member, classInfo));
    }
  }

  if (!decl.body.some((m: any) => m.type === "Constructor")) {
    const { constructor, init } = generateDefaultConstructorPair(name, classInfo);
    fns.push(init);
    fns.push(constructor);
  }

  const implementsList: string[] = [];
  if (decl.implements) {
    for (const impl of decl.implements) {
      if (impl.expression?.type === "Identifier") {
        implementsList.push(impl.expression.value);
      }
    }
  }

  return {
    hirClass: {
      name,
      fields: hirFields,
      methods: fns,
      parent: parentName,
      implements: implementsList.length > 0 ? implementsList : undefined,
    },
    fns,
  };
}

function lowerConstructorPair(
  className: string,
  ctor: any,
  classInfo: { fields: { name: string; type: HIRType }[] },
): { constructor: HIRFunction; init: HIRFunction } {
  const savedLocals = new Map(locals);
  const savedNextId = nextId;
  locals.clear();
  setNextId(0);

  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = freshId();
  locals.set("this", { id: thisId, type: thisType, mutable: false });

  const ctorParams: HIRParam[] = [];
  for (const p of ctor.params) {
    const pat = p.pat || p;
    if (pat.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation(pat.typeAnnotation);
      ctorParams.push({ id, name: pat.value, type });
      locals.set(pat.value, { id, type, mutable: true });
    }
  }

  functionRegistry.set(`${className}_constructor`, { params: ctorParams, returnType: thisType });
  functionRegistry.set(`${className}_init`, {
    params: [{ id: thisId, name: "this", type: thisType }, ...ctorParams],
    returnType: VOID,
  });

  setCurrentClassName(className);
  setIsModuleScope(false);
  const initBody: HIRStmt[] = ctor.body ? lowerBlock(ctor.body) : [];
  setIsModuleScope(true);
  setCurrentClassName(null);

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  setNextId(savedNextId);

  const initParams: HIRParam[] = [{ id: 0, name: "this", type: thisType }, ...ctorParams];
  const init: HIRFunction = {
    name: `${className}_init`,
    params: initParams,
    returnType: VOID,
    body: initBody,
    isAsync: false,
    captures: [],
  };

  const allocExpr: HIRExpr = {
    kind: "alloc_struct",
    structName: className,
    fields: classInfo.fields.map((f) => defaultValue(f.type)),
    type: thisType,
  };
  const initCallArgs: HIRExpr[] = [
    { kind: "local_get", id: 0, type: thisType },
    ...ctorParams.map((p) => ({ kind: "local_get" as const, id: p.id, type: p.type })),
  ];
  const constructorBody: HIRStmt[] = [
    { kind: "let", id: 0, name: "this", type: thisType, init: allocExpr, mutable: false },
    {
      kind: "expr",
      expr: {
        kind: "call",
        callee: `${className}_init`,
        args: initCallArgs,
        returnType: VOID,
        type: VOID,
      },
    },
    { kind: "return", value: { kind: "local_get", id: 0, type: thisType } },
  ];

  const constructor: HIRFunction = {
    name: `${className}_constructor`,
    params: ctorParams,
    returnType: thisType,
    body: constructorBody,
    isAsync: false,
    captures: [],
  };

  return { constructor, init };
}

function lowerMethod(
  className: string,
  method: any,
  classInfo: { fields: { name: string; type: HIRType }[] },
): HIRFunction {
  const savedLocals = new Map(locals);
  const savedNextId = nextId;
  locals.clear();
  setNextId(0);

  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = freshId();
  locals.set("this", { id: thisId, type: thisType, mutable: false });

  const params: HIRParam[] = [{ id: thisId, name: "this", type: thisType }];
  const fn = method.function;
  for (const p of fn.params) {
    if (p.pat?.type === "Identifier") {
      const id = freshId();
      const type = resolveTypeAnnotation(p.pat.typeAnnotation);
      params.push({ id, name: p.pat.value, type });
      locals.set(p.pat.value, { id, type, mutable: true });
    }
  }

  const returnType = fn.returnType ? resolveTypeAnnotation(fn.returnType) : VOID;

  setCurrentClassName(className);
  setIsModuleScope(false);
  const body = fn.body ? lowerBlock(fn.body) : [];
  setIsModuleScope(true);
  setCurrentClassName(null);

  locals.clear();
  for (const [k, v] of savedLocals) locals.set(k, v);
  setNextId(savedNextId);

  return {
    name: `${className}_${method.key.value}`,
    params,
    returnType,
    body,
    isAsync: fn.async || false,
    captures: [],
    line: method.span ? offsetToLine(method.span.start) : undefined,
  };
}

function generateDefaultConstructorPair(
  className: string,
  classInfo: { fields: { name: string; type: HIRType }[] },
): { constructor: HIRFunction; init: HIRFunction } {
  const thisType: HIRType = { kind: "ptr", pointee: className };

  functionRegistry.set(`${className}_init`, {
    params: [{ id: 0, name: "this", type: thisType }],
    returnType: VOID,
  });

  const init: HIRFunction = {
    name: `${className}_init`,
    params: [{ id: 0, name: "this", type: thisType }],
    returnType: VOID,
    body: [],
    isAsync: false,
    captures: [],
  };

  const allocExpr: HIRExpr = {
    kind: "alloc_struct",
    structName: className,
    fields: classInfo.fields.map((f) => defaultValue(f.type)),
    type: thisType,
  };
  const constructor: HIRFunction = {
    name: `${className}_constructor`,
    params: [],
    returnType: thisType,
    body: [
      { kind: "let", id: 0, name: "this", type: thisType, init: allocExpr, mutable: false },
      {
        kind: "expr",
        expr: {
          kind: "call",
          callee: `${className}_init`,
          args: [{ kind: "local_get", id: 0, type: thisType }],
          returnType: VOID,
          type: VOID,
        },
      },
      { kind: "return", value: { kind: "local_get", id: 0, type: thisType } },
    ],
    isAsync: false,
    captures: [],
  };

  return { constructor, init };
}
