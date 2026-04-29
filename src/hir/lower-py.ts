import type { SyntaxNode } from "../parser-py.js";
import type {
  HIRModule,
  HIRFunction,
  HIRClass,
  HIRStmt,
  HIRExpr,
  HIRType,
  HIRParam,
  HIRGlobal,
  SourceInfo,
} from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";
import { resolveType, defaultValue, namedChildren } from "./lower-py-types.js";
import { lowerExpr } from "./lower-py-exprs.js";
import { lowerStmt, lowerBlock, lowerAssignment } from "./lower-py-stmts.js";

let nextId = 0;

export function lowerPythonModule(
  root: SyntaxNode,
  source: string,
  filename: string,
): HIRModule {
  nextId = 0;

  const ctx: LowerCtx = {
    locals: new Map(),
    functions: new Map(),
    classes: new Map(),
    classParents: new Map(),
    dynobjClasses: new Set(),
    instanceClasses: new Map(),
    currentClassName: null,
    pendingStmts: [],
    pendingFunctions: [],
    freshId: () => nextId++,
    lowerExpr: (node) => lowerExpr(node, ctx),
    lowerStmt: (node) => lowerStmt(node, ctx),
    lowerBlock: (node) => lowerBlock(node, ctx),
    lowerFunctionNode: (node) => lowerFunction(node, ctx),
  };

  const hirFunctions: HIRFunction[] = [];
  const hirClasses: HIRClass[] = [];
  const hirGlobals: HIRGlobal[] = [];
  const initStmts: HIRStmt[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    if (child.type === "class_definition") registerClass(child, ctx);
  }

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    if (child.type === "function_definition") registerFunction(child, ctx);
  }

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)!;
    switch (child.type) {
      case "function_definition":
        hirFunctions.push(lowerFunction(child, ctx));
        break;
      case "class_definition": {
        const { hirClass, fns } = lowerClass(child, ctx);
        hirClasses.push(hirClass);
        hirFunctions.push(...fns);
        break;
      }
      case "expression_statement":
      case "if_statement":
      case "while_statement":
      case "for_statement":
      case "try_statement":
      case "delete_statement":
      case "raise_statement":
      case "with_statement": {
        const prev = ctx.pendingStmts;
        ctx.pendingStmts = [];
        const lowered = lowerStmt(child, ctx);
        initStmts.push(...ctx.pendingStmts, ...lowered);
        ctx.pendingStmts = prev;
        break;
      }
      case "import_statement":
      case "import_from_statement":
      case "comment":
        break;
      default:
        throw new Error(`unsupported top-level node: ${child.type}`);
    }
  }

  hirFunctions.push({
    name: "__py_main",
    params: [],
    returnType: I64,
    body: [
      ...initStmts,
      { kind: "return", value: { kind: "literal_i64", value: 0, type: I64 } },
    ],
    isAsync: false,
    captures: [],
  });

  const sourceInfo: SourceInfo = {
    filename,
    directory: filename.replace(/\/[^/]+$/, ""),
    source,
  };

  return {
    functions: [...ctx.pendingFunctions, ...hirFunctions],
    classes: hirClasses,
    interfaces: [],
    globals: hirGlobals,
    init: [],
    sourceInfo,
  };
}

function registerClass(node: SyntaxNode, ctx: LowerCtx): void {
  const name = node.childForFieldName("name")!.text;
  const body = node.childForFieldName("body")!;
  const fields: { name: string; type: HIRType }[] = [];

  const argList = node.namedChild(1);
  if (argList && argList.type === "argument_list" && argList.namedChildCount > 0) {
    const superName = argList.namedChild(0)!.text;
    if (superName !== "Generic" && ctx.classes.has(superName)) {
      ctx.classParents.set(name, superName);
      const parentFields = ctx.classes.get(superName)!.fields;
      fields.push(...parentFields);
    }
  }

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i)!;
    if (member.type !== "expression_statement") continue;
    const inner = member.namedChild(0)!;
    if (inner.type !== "assignment") continue;
    const children = namedChildren(inner);
    if (children.length < 2) continue;
    const nameNode = children[0];
    if (nameNode.type !== "identifier") continue;
    const typeNode = children.find((c) => c.type === "type");
    if (!typeNode) continue;
    fields.push({ name: nameNode.text, type: resolveType(typeNode, ctx) });
  }

  if (fields.length === 0 && !ctx.classParents.has(name)) {
    ctx.dynobjClasses.add(name);
  }

  ctx.classes.set(name, { fields });
}

function registerFunction(node: SyntaxNode, ctx: LowerCtx): void {
  const name = node.childForFieldName("name")!.text;
  const paramsNode = node.childForFieldName("parameters")!;
  const returnTypeNode = node.childForFieldName("return_type");
  const returnType = returnTypeNode ? resolveType(returnTypeNode, ctx) : VOID;
  const params: HIRType[] = [];
  let variadicIdx: number | undefined;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const firstChild = p.namedChild(0)!;
      if (firstChild.type === "list_splat_pattern") {
        const elemType = resolveType(p.childForFieldName("type")!, ctx);
        params.push({ kind: "array", element: elemType });
        variadicIdx = i;
      } else {
        params.push(resolveType(p.childForFieldName("type")!, ctx));
      }
    } else {
      params.push(BOXED);
    }
  }

  ctx.functions.set(name, { params, returnType, variadicIdx });
}

function inferParamTypeFromUsage(name: string, bodyNode: SyntaxNode): HIRType {
  function scan(n: SyntaxNode): HIRType | null {
    if (n.type === "call") {
      const fn = n.childForFieldName("function");
      const args = n.childForFieldName("arguments");
      if (fn && args) {
        const fnText = fn.text;
        const firstArg = args.namedChild(0);
        if (firstArg?.text === name || firstArg?.type === "identifier" && firstArg.text === name) {
          if (fnText === "min" || fnText === "max" || fnText === "sum" || fnText === "sorted" ||
              fnText === "len" || fnText === "reversed" || fnText === "enumerate") {
            return { kind: "array", element: { kind: "i64" } };
          }
        }
        if (fn.type === "attribute") {
          const obj = fn.namedChild(0); const method = fn.namedChild(1)?.text;
          if (obj?.text === name) {
            if (method === "append" || method === "extend" || method === "sort" ||
                method === "index" || method === "pop" || method === "reverse") {
              return { kind: "array", element: { kind: "i64" } };
            }
            if (method === "keys" || method === "values" || method === "items" ||
                method === "get" || method === "update") {
              return { kind: "map", key: { kind: "i8ptr" }, value: { kind: "f64" } };
            }
          }
        }
      }
    }
    if (n.type === "for_statement") {
      const right = n.childForFieldName("right");
      if (right?.text === name) return { kind: "array", element: { kind: "f64" } };
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const r = scan(n.namedChild(i)!);
      if (r) return r;
    }
    return null;
  }
  return scan(bodyNode) ?? BOXED;
}

function inferReturnType(stmts: HIRStmt[]): HIRType | null {
  for (const s of stmts) {
    if (s.kind === "return" && s.value && s.value.type.kind !== "void") return s.value.type;
    if (s.kind === "if") {
      const t = inferReturnType(s.then) ?? (s.else ? inferReturnType(s.else) : null);
      if (t) return t;
    }
    if (s.kind === "for") { const t = inferReturnType(s.body); if (t) return t; }
  }
  return null;
}

function lowerFunction(node: SyntaxNode, ctx: LowerCtx): HIRFunction {
  const savedLocals = new Map(ctx.locals);
  ctx.locals = new Map();

  const name = node.childForFieldName("name")!.text;
  const paramsNode = node.childForFieldName("parameters")!;
  const returnTypeNode = node.childForFieldName("return_type");
  const body = node.childForFieldName("body")!;

  const returnType = returnTypeNode ? resolveType(returnTypeNode, ctx) : VOID;
  const params: HIRParam[] = [];

  let variadicIdx: number | undefined;
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const firstChild = p.namedChild(0)!;
      const isSplat = firstChild.type === "list_splat_pattern";
      const pName = isSplat ? firstChild.namedChild(0)!.text : firstChild.text;
      const pTypeNode = p.childForFieldName("type")!;
      const elemType = resolveType(pTypeNode, ctx);
      const pType: HIRType = isSplat ? { kind: "array", element: elemType } : elemType;
      const id = ctx.freshId();
      params.push({ id, name: pName, type: pType });
      ctx.locals.set(pName, { id, name: pName, type: pType });
      if (isSplat) variadicIdx = i;
    } else if (p.type === "identifier") {
      const pName = p.text;
      const inferredType = inferParamTypeFromUsage(pName, body);
      const id = ctx.freshId();
      params.push({ id, name: pName, type: inferredType });
      ctx.locals.set(pName, { id, name: pName, type: inferredType });
    }
  }

  ctx.functions.set(name, { params: params.map((p) => p.type), returnType, variadicIdx });

  const hirBody = lowerBlock(body, ctx);

  ctx.locals = savedLocals;

  const inferredReturnType = returnTypeNode ? returnType : (inferReturnType(hirBody) ?? returnType);
  if (inferredReturnType !== returnType) {
    ctx.functions.set(name, { params: params.map((p) => p.type), returnType: inferredReturnType, variadicIdx });
  }

  return { name, params, returnType: inferredReturnType, body: hirBody, isAsync: false, captures: [] };
}

function lowerClass(
  node: SyntaxNode,
  ctx: LowerCtx,
): { hirClass: HIRClass; fns: HIRFunction[] } {
  const className = node.childForFieldName("name")!.text;
  if (ctx.dynobjClasses.has(className)) {
    return lowerDynobjClass(node, ctx);
  }
  const body = node.childForFieldName("body")!;
  const classInfo = ctx.classes.get(className)!;
  const fns: HIRFunction[] = [];
  const thisType: HIRType = { kind: "ptr", pointee: className };

  let hasInit = false;

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i)!;
    if (member.type !== "function_definition") continue;
    const methodName = member.childForFieldName("name")!.text;
    if (methodName === "__init__") {
      hasInit = true;
      const { init, constructor } = lowerInitPair(className, member, classInfo, ctx);
      fns.push(init, constructor);
    } else {
      fns.push(lowerMethod(className, member, classInfo, ctx));
    }
  }

  if (!hasInit) {
    const id = ctx.freshId();
    ctx.functions.set(`${className}_constructor`, { params: [], returnType: thisType });
    const allocExpr: HIRExpr = {
      kind: "alloc_struct",
      structName: className,
      fields: classInfo.fields.map((f) => defaultValue(f.type)),
      type: thisType,
    };
    fns.push({
      name: `${className}_constructor`,
      params: [],
      returnType: thisType,
      body: [
        { kind: "let", id, name: "__self", type: thisType, init: allocExpr, mutable: false },
        { kind: "return", value: { kind: "local_get", id, type: thisType } },
      ],
      isAsync: false,
      captures: [],
    });
  }

  return {
    hirClass: { name: className, fields: classInfo.fields, methods: [] },
    fns,
  };
}

function lowerInitPair(
  className: string,
  initDef: SyntaxNode,
  classInfo: { fields: { name: string; type: HIRType }[] },
  ctx: LowerCtx,
): { init: HIRFunction; constructor: HIRFunction } {
  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = ctx.freshId();

  const savedLocals = new Map(ctx.locals);
  ctx.locals = new Map();
  ctx.locals.set("self", { id: thisId, name: "self", type: thisType });

  const paramsNode = initDef.childForFieldName("parameters")!;
  const params: HIRParam[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "identifier" && p.text === "self") continue;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const pName = p.namedChild(0)!.text;
      const pType = resolveType(p.childForFieldName("type")!, ctx);
      const id = ctx.freshId();
      params.push({ id, name: pName, type: pType });
      ctx.locals.set(pName, { id, name: pName, type: pType });
    } else if (p.type === "identifier") {
      const id = ctx.freshId();
      params.push({ id, name: p.text, type: BOXED });
      ctx.locals.set(p.text, { id, name: p.text, type: BOXED });
    }
  }

  ctx.functions.set(`${className}_init`, {
    params: [thisType, ...params.map((p) => p.type)],
    returnType: VOID,
  });
  ctx.functions.set(`${className}_constructor`, {
    params: params.map((p) => p.type),
    returnType: thisType,
  });

  const savedClass = ctx.currentClassName;
  ctx.currentClassName = className;
  const initBody = lowerBlock(initDef.childForFieldName("body")!, ctx);
  ctx.currentClassName = savedClass;

  ctx.locals = savedLocals;

  const init: HIRFunction = {
    name: `${className}_init`,
    params: [{ id: thisId, name: "self", type: thisType }, ...params],
    returnType: VOID,
    body: initBody,
    isAsync: false,
    captures: [],
  };

  const selfLocalId = ctx.freshId();
  const allocExpr: HIRExpr = {
    kind: "alloc_struct",
    structName: className,
    fields: classInfo.fields.map((f) => defaultValue(f.type)),
    type: thisType,
  };
  const constructor: HIRFunction = {
    name: `${className}_constructor`,
    params,
    returnType: thisType,
    body: [
      { kind: "let", id: selfLocalId, name: "__self", type: thisType, init: allocExpr, mutable: false },
      {
        kind: "expr",
        expr: {
          kind: "call",
          callee: `${className}_init`,
          args: [
            { kind: "local_get", id: selfLocalId, type: thisType },
            ...params.map((p) => ({ kind: "local_get" as const, id: p.id, type: p.type })),
          ],
          returnType: VOID,
          type: VOID,
        },
      },
      { kind: "return", value: { kind: "local_get", id: selfLocalId, type: thisType } },
    ],
    isAsync: false,
    captures: [],
  };

  return { init, constructor };
}

function lowerMethod(
  className: string,
  methodDef: SyntaxNode,
  classInfo: { fields: { name: string; type: HIRType }[] },
  ctx: LowerCtx,
): HIRFunction {
  const methodName = methodDef.childForFieldName("name")!.text;
  const thisType: HIRType = { kind: "ptr", pointee: className };
  const thisId = ctx.freshId();

  const savedLocals = new Map(ctx.locals);
  ctx.locals = new Map();
  ctx.locals.set("self", { id: thisId, name: "self", type: thisType });

  const paramsNode = methodDef.childForFieldName("parameters")!;
  const returnTypeNode = methodDef.childForFieldName("return_type");
  const returnType = returnTypeNode ? resolveType(returnTypeNode, ctx) : VOID;
  const params: HIRParam[] = [{ id: thisId, name: "self", type: thisType }];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "identifier" && p.text === "self") continue;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const pName = p.namedChild(0)!.text;
      const pType = resolveType(p.childForFieldName("type")!, ctx);
      const id = ctx.freshId();
      params.push({ id, name: pName, type: pType });
      ctx.locals.set(pName, { id, name: pName, type: pType });
    } else if (p.type === "identifier") {
      const id = ctx.freshId();
      params.push({ id, name: p.text, type: BOXED });
      ctx.locals.set(p.text, { id, name: p.text, type: BOXED });
    }
  }

  ctx.functions.set(`${className}_${methodName}`, {
    params: params.map((p) => p.type),
    returnType,
  });

  const savedClass = ctx.currentClassName;
  ctx.currentClassName = className;
  const body = lowerBlock(methodDef.childForFieldName("body")!, ctx);
  ctx.currentClassName = savedClass;

  ctx.locals = savedLocals;

  return {
    name: `${className}_${methodName}`,
    params,
    returnType,
    body,
    isAsync: false,
    captures: [],
  };
}

function lowerDynobjClass(
  node: SyntaxNode,
  ctx: LowerCtx,
): { hirClass: HIRClass; fns: HIRFunction[] } {
  const className = node.childForFieldName("name")!.text;
  const body = node.childForFieldName("body")!;
  const fns: HIRFunction[] = [];

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i)!;
    if (member.type !== "function_definition") continue;
    const methodName = member.childForFieldName("name")!.text;
    fns.push(lowerDynobjMethod(className, methodName, member, ctx));
  }

  if (!ctx.functions.has(`${className}___init__`)) {
    const instanceId = ctx.freshId();
    ctx.functions.set(`${className}_constructor`, { params: [], returnType: DYNOBJ });
    fns.push({
      name: `${className}_constructor`,
      params: [],
      returnType: DYNOBJ,
      body: [
        {
          kind: "let", id: instanceId, name: "__self", type: DYNOBJ, mutable: false,
          init: { kind: "runtime_call", func: "cs2_dynobj_new", args: [], returnType: DYNOBJ, type: DYNOBJ },
        },
        { kind: "return", value: { kind: "local_get", id: instanceId, type: DYNOBJ } },
      ],
      isAsync: false,
      captures: [],
    });
  }

  return { hirClass: { name: className, fields: [], methods: [] }, fns };
}

function lowerDynobjMethod(
  className: string,
  methodName: string,
  methodDef: SyntaxNode,
  ctx: LowerCtx,
): HIRFunction {
  const funcName = `${className}_${methodName}`;
  const paramsNode = methodDef.childForFieldName("parameters")!;
  const returnTypeNode = methodDef.childForFieldName("return_type");
  const returnType = returnTypeNode ? resolveType(returnTypeNode, ctx) : VOID;

  const thisId = ctx.freshId();
  const savedLocals = new Map(ctx.locals);
  ctx.locals = new Map();
  ctx.locals.set("self", { id: thisId, name: "self", type: DYNOBJ });

  const params: HIRParam[] = [{ id: thisId, name: "self", type: DYNOBJ }];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i)!;
    if (p.type === "identifier" && p.text === "self") continue;
    if (p.type === "typed_parameter" || p.type === "typed_default_parameter") {
      const pName = p.namedChild(0)!.text;
      const pType = resolveType(p.childForFieldName("type")!, ctx);
      const id = ctx.freshId();
      params.push({ id, name: pName, type: pType });
      ctx.locals.set(pName, { id, name: pName, type: pType });
    } else if (p.type === "identifier") {
      const id = ctx.freshId();
      params.push({ id, name: p.text, type: BOXED });
      ctx.locals.set(p.text, { id, name: p.text, type: BOXED });
    }
  }

  ctx.functions.set(funcName, { params: params.map((p) => p.type), returnType });

  const savedClass = ctx.currentClassName;
  ctx.currentClassName = className;
  const hirBody = lowerBlock(methodDef.childForFieldName("body")!, ctx);
  ctx.currentClassName = savedClass;

  ctx.locals = savedLocals;

  const inferredReturn = returnTypeNode ? returnType : (inferReturnType(hirBody) ?? returnType);
  if (inferredReturn !== returnType) {
    ctx.functions.set(funcName, { params: params.map((p) => p.type), returnType: inferredReturn });
  }

  if (methodName === "__init__") {
    const constructorId = ctx.freshId();
    const initParams = params.slice(1);
    ctx.functions.set(`${className}_constructor`, {
      params: initParams.map((p) => p.type),
      returnType: DYNOBJ,
    });
    ctx.pendingFunctions.push({
      name: `${className}_constructor`,
      params: initParams,
      returnType: DYNOBJ,
      body: [
        {
          kind: "let", id: constructorId, name: "__self", type: DYNOBJ, mutable: false,
          init: { kind: "runtime_call", func: "cs2_dynobj_new", args: [], returnType: DYNOBJ, type: DYNOBJ },
        },
        {
          kind: "expr",
          expr: {
            kind: "call",
            callee: funcName,
            args: [
              { kind: "local_get", id: constructorId, type: DYNOBJ },
              ...initParams.map((p) => ({ kind: "local_get" as const, id: p.id, type: p.type })),
            ],
            returnType: VOID,
            type: VOID,
          },
        },
        { kind: "return", value: { kind: "local_get", id: constructorId, type: DYNOBJ } },
      ],
      isAsync: false,
      captures: [],
    });
  }

  return {
    name: funcName,
    params,
    returnType: inferredReturn,
    body: hirBody,
    isAsync: false,
    captures: [],
  };
}
