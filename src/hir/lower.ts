import type {
  Module,
  ModuleItem,
  Statement,
  Expression,
  VariableDeclaration,
  FunctionDeclaration,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  BlockStatement,
} from "@swc/core";

import type {
  HIRModule,
  HIRFunction,
  HIRStmt,
  HIRExpr,
  HIRType,
  HIRParam,
  HIRClass,
  HIRInterface,
  HIRGlobal,
  HIRExternFn,
  HIRSwitchCase,
  SourceInfo,
} from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ, DYNARRAY } from "./types.js";
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
  isModuleScope,
  expectedArrayElementType,
  nextAnonId,
  freshId,
  setNextId,
  setIsModuleScope,
  setExpectedArrayElementType,
  setExpectedMapType,
  setExpectedDeclType,
  currentReturnType,
  incNextAnonId,
  setSourceText,
  setLineOffsets,
  buildLineOffsets,
  resolveTypeAnnotation,
  resolveObjectDestructProps,
  coerce,
  coerceToCondition,
  defaultValue,
  withLine,
  arrayPrefix,
  mapPrefix,
  genericFunctionTemplates,
  genericClassTemplates,
  genericSpecializations,
  setTypeParamContext,
  enumRegistry,
  typeAliasRegistry,
  builtinImports,
  setSourceFilePath,
  narrowedLocals,
  pushNarrowing,
  popNarrowing,
} from "./lower-state.js";
import {
  registerFunction,
  registerInterface,
  registerClass,
  lowerClassDecl,
} from "./lower-class.js";
import { lowerExpr, drainPendingGenericClasses, untypedDynObjAccesses } from "./lower-expr.js";
import { lowerFunctionDecl, lowerArrowOrFnExpr, lowerNestedFunctionDecl } from "./lower-func.js";
import {
  isGenericFunction,
  isGenericClass,
  storeGenericFunctionTemplate,
  storeGenericClassTemplate,
} from "./lower-generic.js";

export { lowerExpr } from "./lower-expr.js";

function unwrapExport(item: ModuleItem): ModuleItem {
  if ((item as any).type === "ExportDeclaration") {
    return (item as any).declaration as ModuleItem;
  }
  return item;
}

export interface ImportAlias {
  local: string;
  imported: string;
}

export interface BuiltinImport {
  local: string;
  module: string;
  imported: string;
}

export function lowerModule(
  ast: Module,
  source?: string,
  filename?: string,
  importAliases?: ImportAlias[],
  builtinImportList?: BuiltinImport[],
  bodyOverride?: any[],
): HIRModule {
  const functions: HIRFunction[] = [];
  const hirClasses: HIRClass[] = [];
  const hirInterfaces: import("./types.js").HIRInterface[] = [];
  const hirGlobals: HIRGlobal[] = [];
  const init: HIRStmt[] = [];
  const externFns: HIRExternFn[] = [];

  functionRegistry.clear();
  classRegistry.clear();
  interfaceRegistry.clear();
  globals.clear();
  fnAliases.clear();
  pendingFunctions.length = 0;
  closureInfoMap.clear();
  restParamRegistry.clear();
  genericFunctionTemplates.clear();
  genericClassTemplates.clear();
  genericSpecializations.clear();
  enumRegistry.clear();
  typeAliasRegistry.clear();
  builtinImports.clear();
  setTypeParamContext(null);
  setNextId(0);
  setIsModuleScope(true);
  const src = source ? source : "";
  setSourceText(src);
  setLineOffsets(buildLineOffsets(src));
  const fname = filename ? filename : null;
  setSourceFilePath(fname);

  const body = bodyOverride ? bodyOverride : ast.body;

  const errorThisType: HIRType = { kind: "ptr", pointee: "Error" };
  classRegistry.set("Error", {
    fields: [
      { name: "message", type: I8PTR },
      { name: "name", type: I8PTR },
    ],
    methods: new Map(),
    parent: undefined,
  });
  functionRegistry.set("Error_init", {
    params: [
      { id: 0, name: "this", type: errorThisType },
      { id: 1, name: "message", type: I8PTR },
    ],
    returnType: VOID,
  });
  functionRegistry.set("Error_constructor", {
    params: [{ id: 0, name: "message", type: I8PTR }],
    returnType: errorThisType,
  });
  hirClasses.push({
    name: "Error",
    fields: [
      { name: "message", type: I8PTR },
      { name: "name", type: I8PTR },
    ],
    methods: [],
    parent: undefined,
  });
  functions.push({
    name: "Error_init",
    params: [
      { id: 0, name: "this", type: errorThisType },
      { id: 1, name: "message", type: I8PTR },
    ],
    returnType: VOID,
    body: [
      {
        kind: "expr",
        expr: {
          kind: "field_set",
          object: { kind: "local_get", id: 0, type: errorThisType },
          fieldName: "message",
          index: 0,
          value: { kind: "local_get", id: 1, type: I8PTR },
          type: I8PTR,
        },
      },
    ],
    isAsync: false,
    captures: [],
  });

  if (importAliases) {
    for (const alias of importAliases) {
      fnAliases.set(alias.local, alias.imported);
    }
  }
  if (builtinImportList) {
    for (const bi of builtinImportList) {
      builtinImports.set(bi.local, { module: bi.module, imported: bi.imported });
    }
  }

  for (const item of body) {
    const inner = unwrapExport(item);
    if ((inner as any).type === "TsInterfaceDeclaration") {
      interfaceRegistry.set((inner as any).id.value, { fields: [], methods: [] });
    }
  }

  for (const item of body) {
    const inner = unwrapExport(item) as any;
    if (inner.type === "TsTypeAliasDeclaration" && inner.id?.type === "Identifier") {
      typeAliasRegistry.set(inner.id.value, resolveTypeAnnotation(inner.typeAnnotation));
    }
  }



  for (const item of body) {
    const inner = unwrapExport(item);
    if ((inner as any).type === "TsInterfaceDeclaration") {
      registerInterface(inner as any);
    }
  }



  for (const item of body) {
    const inner = unwrapExport(item);
    if (inner.type === "ClassDeclaration") {
      if (isGenericClass(inner as any)) {
        storeGenericClassTemplate(inner as any);
      } else {
        registerClass(inner as any);
      }
    }
  }



  for (const item of body) {
    const inner = unwrapExport(item);
    if (inner.type === "FunctionDeclaration") {
      if (isGenericFunction(inner as any)) {
        storeGenericFunctionTemplate(inner as any);
      } else {
        registerFunction(inner);
      }
    }
  }



  for (const item of body) {
    const inner = unwrapExport(item);
    if ((inner as any).type === "TsEnumDeclaration") {
      const enumDecl = inner as any;
      const enumName = enumDecl.id.value;
      let autoValue = 0;
      const members: { name: string; value: number | string }[] = [];
      for (const member of enumDecl.members) {
        const memberName = member.id.value;
        if (member.init) {
          if (member.init.type === "NumericLiteral") {
            autoValue = member.init.value;
            members.push({ name: memberName, value: autoValue });
            autoValue++;
          } else if (member.init.type === "StringLiteral") {
            members.push({ name: memberName, value: member.init.value });
          } else {
            members.push({ name: memberName, value: autoValue++ });
          }
        } else {
          members.push({ name: memberName, value: autoValue++ });
        }
      }
      const isStringEnum = members.some((m) => typeof m.value === "string");
      const memberType = isStringEnum ? I8PTR : I64;
      for (const m of members) {
        const globalName = `${enumName}_${m.name}`;
        globals.set(globalName, { type: memberType, mutable: false });
        hirGlobals.push({ name: globalName, type: memberType, mutable: false });
        const initExpr: HIRExpr =
          typeof m.value === "string"
            ? { kind: "literal_string", value: m.value, type: I8PTR }
            : { kind: "literal_i64", value: m.value, type: I64 };
        init.push({
          kind: "expr",
          expr: { kind: "global_set", name: globalName, value: initExpr, type: memberType },
        });
      }
      enumRegistry.set(enumName, { members, memberType });
    }
  }



  for (const item of body) {
    const inner = unwrapExport(item);
    if (inner.type !== "VariableDeclaration") continue;
    const varDecl0 = inner as VariableDeclaration;
    for (const d of varDecl0.declarations) {
      if (d.id.type !== "Identifier") continue;
      if (globals.has(d.id.value)) continue;
      const ann = (d.id as any).typeAnnotation;
      if (ann) {
        const t = resolveTypeAnnotation(ann);
        if (t.kind !== "boxed") {
          const mutable = varDecl0.kind === "let" || varDecl0.kind === "var";
          globals.set(d.id.value, { type: t, mutable });
          continue;
        }
      }
      if (d.init && (d.init as any).type === "NewExpression") {
        const newExpr = d.init as any;
        const cn = newExpr.callee?.value;
        const ta = newExpr.typeArguments?.params;
        if (cn === "Map" && ta?.length === 2) {
          const key = resolveTypeAnnotation(ta[0]);
          const val = resolveTypeAnnotation(ta[1]);
          const mutable = varDecl0.kind === "let" || varDecl0.kind === "var";
          globals.set(d.id.value, { type: { kind: "map", key, value: val }, mutable });
        } else if (cn === "Set" && ta?.length === 1) {
          const elem = resolveTypeAnnotation(ta[0]);
          const mutable = varDecl0.kind === "let" || varDecl0.kind === "var";
          globals.set(d.id.value, { type: { kind: "set", element: elem }, mutable });
        }
      }
    }
  }

  for (const item of body) {
    const inner = unwrapExport(item);
    switch ((inner as any).type) {
    case "ImportDeclaration":
    case "TsInterfaceDeclaration":
    case "TsEnumDeclaration":
    case "TsTypeAliasDeclaration":
      continue;
    case "ClassDeclaration":
      if (isGenericClass(inner as any)) continue;
      {
        const { hirClass, fns } = lowerClassDecl(inner as any);
        hirClasses.push(hirClass);
        functions.push(...fns);
      }
      break;
    case "FunctionDeclaration":
      if (isGenericFunction(inner as any)) continue;
      if ((inner as any).declare) {
        const info = functionRegistry.get((inner as any).identifier.value);
        if (info) {
          externFns.push({
            name: (inner as any).identifier.value,
            params: info.params,
            returnType: info.returnType,
            variadic: (inner as any).variadic ?? false,
          });
        }
        continue;
      }
      setIsModuleScope(false);
      functions.push(lowerFunctionDecl(inner));
      setIsModuleScope(true);
      break;
    case "VariableDeclaration": {
      const varDecl = inner as VariableDeclaration;
      for (const d of varDecl.declarations) {
        if (d.id.type === "ArrayPattern") {
          const mutable = varDecl.kind === "let" || varDecl.kind === "var";
          if (!d.init) compileError("array destructuring requires initializer", d.span);
          const initExpr = lowerExpr(d.init);
          if (initExpr.type.kind !== "array")
            compileError("array destructuring requires array type", d.span);
          const arrType = initExpr.type as { kind: "array"; element: HIRType };
          const elemType = arrType.element;

          const tmpName = `__destruct_g_${incNextAnonId()}`;
          globals.set(tmpName, { type: initExpr.type, mutable: false });
          hirGlobals.push({ name: tmpName, type: initExpr.type, mutable: false });
          init.push({
            kind: "expr",
            expr: { kind: "global_set", name: tmpName, value: initExpr, type: initExpr.type },
          });

          const elements: any[] = d.id.elements;
          for (let i = 0; i < elements.length; i++) {
            const elem = elements[i];
            if (elem === null) continue;
            if (elem.type !== "Identifier")
              compileError(`unsupported destructuring element: ${elem.type}`, elem.span);

            const indexGet: HIRExpr = {
              kind: "index_get",
              array: { kind: "global_get", name: tmpName, type: initExpr.type },
              index: { kind: "literal_i64", value: i, type: I64 },
              type: elemType,
            };
            globals.set(elem.value, { type: elemType, mutable });
            hirGlobals.push({ name: elem.value, type: elemType, mutable });
            init.push({
              kind: "expr",
              expr: { kind: "global_set", name: elem.value, value: indexGet, type: elemType },
            });
          }
          continue;
        }
        if (d.id.type === "ObjectPattern") {
          const mutable = varDecl.kind === "let" || varDecl.kind === "var";
          if (!d.init) compileError("object destructuring requires initializer", d.span);
          const initExpr = lowerExpr(d.init);

          if (initExpr.type.kind === "dynobj") {
            const props =
              (initExpr.type as { kind: "dynobj"; props?: { name: string; type: HIRType }[] })
                .props || [];
            const tmpName = `__destruct_g_${incNextAnonId()}`;
            globals.set(tmpName, { type: initExpr.type, mutable: false });
            hirGlobals.push({ name: tmpName, type: initExpr.type, mutable: false });
            init.push({
              kind: "expr",
              expr: { kind: "global_set", name: tmpName, value: initExpr, type: initExpr.type },
            });

            for (const { fieldName, localName } of resolveObjectDestructProps(d.id.properties)) {
              const propInfo = props.find((p) => p.name === fieldName);
              const propType = propInfo ? propInfo.type : DYNOBJ;
              const key: HIRExpr = { kind: "literal_string", value: fieldName, type: I8PTR };
              const fieldGet = dynObjGetForType(
                { kind: "global_get", name: tmpName, type: initExpr.type },
                key,
                propType,
              );
              globals.set(localName, { type: propType, mutable });
              hirGlobals.push({ name: localName, type: propType, mutable });
              init.push({
                kind: "expr",
                expr: { kind: "global_set", name: localName, value: fieldGet, type: propType },
              });
            }
            continue;
          }

          if (initExpr.type.kind !== "ptr")
            compileError("object destructuring requires struct/class/object type", d.span);

          const typeName = (initExpr.type as { kind: "ptr"; pointee: string }).pointee;
          const cInfo = classRegistry.get(typeName);
          if (!cInfo) compileError(`object destructuring: unknown class '${typeName}'`, d.span);

          const tmpName = `__destruct_g_${incNextAnonId()}`;
          globals.set(tmpName, { type: initExpr.type, mutable: false });
          hirGlobals.push({ name: tmpName, type: initExpr.type, mutable: false });
          init.push({
            kind: "expr",
            expr: { kind: "global_set", name: tmpName, value: initExpr, type: initExpr.type },
          });

          for (const { fieldName, localName, span } of resolveObjectDestructProps(
            d.id.properties,
          )) {
            const fieldIdx = cInfo!.fields.findIndex((f: any) => f.name === fieldName);
            if (fieldIdx < 0)
              compileError(`property '${fieldName}' does not exist on '${typeName}'`, span);

            const field = cInfo!.fields[fieldIdx];
            const fieldGet: HIRExpr = {
              kind: "field_get",
              object: { kind: "global_get", name: tmpName, type: initExpr.type },
              fieldName,
              index: fieldIdx,
              type: field.type,
            };
            globals.set(localName, { type: field.type, mutable });
            hirGlobals.push({ name: localName, type: field.type, mutable });
            init.push({
              kind: "expr",
              expr: { kind: "global_set", name: localName, value: fieldGet, type: field.type },
            });
          }
          continue;
        }
        if (d.id.type === "Identifier") {
          if (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression") {
            const fn = lowerArrowOrFnExpr(d.init, d.id.value);
            functions.push(fn);
            fnAliases.set(d.id.value, fn.name);
            continue;
          }
          const mutable = varDecl.kind === "let" || varDecl.kind === "var";
          const hasAnnotation = !!d.id.typeAnnotation;
          const declType = resolveTypeAnnotation(d.id.typeAnnotation);
          if (declType.kind === "array")
            setExpectedArrayElementType((declType as { kind: "array"; element: HIRType }).element);
          if (declType.kind === "map") setExpectedMapType(declType);
          if (hasAnnotation) setExpectedDeclType(declType);
          const rawInit = d.init ? lowerExpr(d.init) : undefined;
          setExpectedArrayElementType(null);
          setExpectedMapType(null);
          setExpectedDeclType(null);
          const type =
            declType.kind !== "boxed"
              ? declType
              : rawInit && (rawInit.type.kind === "dynobj" || rawInit.type.kind === "dynarray")
                ? rawInit.type
                : hasAnnotation
                  ? BOXED
                  : rawInit
                    ? rawInit.type
                    : BOXED;
          const coercedInit =
            rawInit && rawInit.type.kind !== type.kind ? coerce(rawInit, type) : rawInit;

          globals.set(d.id.value, { type, mutable });
          hirGlobals.push({ name: d.id.value, type, mutable });

          if (coercedInit) {
            init.push({
              kind: "expr",
              expr: { kind: "global_set", name: d.id.value, value: coercedInit, type },
            });
          }
        }
      }
      break;
    }
    default: {
      const stmts = lowerModuleItem(inner);
      init.push(...stmts);
    }
    }
  }

  functions.push(...pendingFunctions);

  if (classRegistry.has("__PromiseSettledResult")) {
    const info = classRegistry.get("__PromiseSettledResult")!;
    hirClasses.push({
      name: "__PromiseSettledResult",
      fields: info.fields,
      methods: [],
    });
  }

  const genericClasses = drainPendingGenericClasses();
  for (const { hirClass, fns } of genericClasses) {
    hirClasses.push(hirClass);
    functions.push(...fns);
  }

  for (const [name, info] of interfaceRegistry) {
    hirInterfaces.push({
      name,
      fields: info.fields.map((f) => ({ name: f.name, type: f.type })),
      methods: info.methods,
    });
  }

  let si: SourceInfo | undefined;
  if (filename && source) {
    const lastSlash = filename.lastIndexOf("/");
    si = {
      filename: lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename,
      directory: lastSlash >= 0 ? filename.slice(0, lastSlash) : ".",
      source,
    };
  }

  if (untypedDynObjAccesses.length > 0) {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const a of untypedDynObjAccesses) {
      if (!seen.has(a)) {
        seen.add(a);
        unique.push(a);
      }
    }
    console.error(`\n[ERROR] ${unique.length} untyped dynobj field accesses (will be BOXED at runtime):`);
    for (const a of unique) {
      console.error(`  ${a}`);
    }
    console.error("");
    untypedDynObjAccesses.length = 0;
  }

  return {
    functions,
    classes: hirClasses,
    interfaces: hirInterfaces,
    globals: hirGlobals,
    init,
    externFns,
    sourceInfo: si,
  };
}

export function lowerModuleItem(item: ModuleItem): HIRStmt[] {
  switch (item.type) {
    case "VariableDeclaration":
      return lowerVarDecl(item);
    case "ExpressionStatement":
      return [withLine({ kind: "expr", expr: lowerExpr(item.expression) } as HIRStmt, item)];
    case "ReturnStatement":
      return [withLine(lowerReturn(item), item)];
    case "IfStatement":
      return [withLine(lowerIf(item), item)];
    case "WhileStatement":
      return [withLine(lowerWhile(item), item)];
    case "ForStatement":
      return [withLine(lowerFor(item), item)];
    case "ForOfStatement":
      return lowerForOf(item as any);
    case "DoWhileStatement":
      return [withLine(lowerDoWhile(item as any), item)];
    case "SwitchStatement":
      return [withLine(lowerSwitch(item as any), item)];
    case "BlockStatement":
      return lowerBlock(item);
    case "BreakStatement":
      return [withLine({ kind: "break" } as HIRStmt, item)];
    case "ContinueStatement":
      return [withLine({ kind: "continue" } as HIRStmt, item)];
    case "ThrowStatement":
      return [withLine(lowerThrow(item as any), item)];
    case "TryStatement":
      return [withLine(lowerTry(item as any), item)];
    case "FunctionDeclaration": {
      registerFunction(item as FunctionDeclaration);
      fnAliases.set((item as FunctionDeclaration).identifier.value, (item as FunctionDeclaration).identifier.value);
      const fn = lowerNestedFunctionDecl(item as FunctionDeclaration);
      pendingFunctions.push(fn);
      fnAliases.set(fn.name, fn.name);
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
      }
      return [];
    }
    case "TsTypeAliasDeclaration":
    case "TsInterfaceDeclaration":
      return [];
    default:
      compileError(`unsupported statement type: ${item.type}`);
  }
}

export function lowerBlock(block: BlockStatement): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  for (const stmt of block.stmts) {
    stmts.push(...lowerModuleItem(stmt as ModuleItem));
  }
  return stmts;
}

function lowerVarDecl(decl: VariableDeclaration): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  const mutable = decl.kind === "let" || decl.kind === "var";

  for (const d of decl.declarations) {
    if (d.id.type === "ArrayPattern") {
      stmts.push(...lowerArrayDestructuring(d, mutable));
      continue;
    }
    if (d.id.type === "ObjectPattern") {
      stmts.push(...lowerObjectDestructuring(d, mutable));
      continue;
    }
    if (d.id.type === "Identifier") {
      if (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression") {
        const fn = lowerArrowOrFnExpr(d.init, d.id.value);
        pendingFunctions.push(fn);
        fnAliases.set(d.id.value, fn.name);
        continue;
      }
      const id = freshId();
      const hasAnnotation = !!d.id.typeAnnotation;
      const declType = resolveTypeAnnotation(d.id.typeAnnotation);
      if (declType.kind === "array")
        setExpectedArrayElementType((declType as { kind: "array"; element: HIRType }).element);
      if (declType.kind === "map") setExpectedMapType(declType);
      if (hasAnnotation) setExpectedDeclType(declType);
      const init = d.init ? lowerExpr(d.init) : undefined;
      setExpectedArrayElementType(null);
      setExpectedMapType(null);
      setExpectedDeclType(null);
      const type =
        declType.kind !== "boxed"
          ? declType
          : init && (init.type.kind === "dynobj" || init.type.kind === "dynarray")
            ? init.type
            : hasAnnotation
              ? BOXED
              : init
                ? init.type
                : BOXED;
      const coercedInit = init && init.type.kind !== type.kind ? coerce(init, type) : init;

      locals.set(d.id.value, { id, type, mutable });
      stmts.push(
        withLine(
          { kind: "let", id, name: d.id.value, type, init: coercedInit, mutable } as HIRStmt,
          d,
        ),
      );
    }
  }

  return stmts;
}

function lowerArrayDestructuring(d: any, mutable: boolean): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  if (!d.init) compileError("array destructuring requires initializer", d.span);

  const initExpr = lowerExpr(d.init);
  if (initExpr.type.kind !== "array")
    compileError("array destructuring requires array type", d.span);

  const arrType = initExpr.type as { kind: "array"; element: HIRType };
  const elemType = arrType.element;

  const tmpId = freshId();
  const tmpName = `__destruct_${tmpId}`;
  locals.set(tmpName, { id: tmpId, type: initExpr.type, mutable: false });
  stmts.push({
    kind: "let",
    id: tmpId,
    name: tmpName,
    type: initExpr.type,
    init: initExpr,
    mutable: false,
  } as HIRStmt);

  const elements: any[] = d.id.elements;
  for (let i = 0; i < elements.length; i++) {
    const elem = elements[i];
    if (elem === null) continue;
    if (elem.type !== "Identifier")
      compileError(`unsupported destructuring element: ${elem.type}`, elem.span);

    const elemId = freshId();
    const indexGet: HIRExpr = {
      kind: "index_get",
      array: { kind: "local_get", id: tmpId, type: initExpr.type },
      index: { kind: "literal_i64", value: i, type: I64 },
      type: elemType,
    };

    locals.set(elem.value, { id: elemId, type: elemType, mutable });
    stmts.push({
      kind: "let",
      id: elemId,
      name: elem.value,
      type: elemType,
      init: indexGet,
      mutable,
    } as HIRStmt);
  }

  return stmts;
}

function dynObjGetForType(obj: HIRExpr, key: HIRExpr, targetType: HIRType): HIRExpr {
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
    default:
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_get_obj",
        args: [obj, key],
        returnType: DYNOBJ,
        type: DYNOBJ,
      };
  }
}

function lowerObjectDestructuring(d: any, mutable: boolean): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  if (!d.init) compileError("object destructuring requires initializer", d.span);

  const initExpr = lowerExpr(d.init);

  if (initExpr.type.kind === "dynobj") {
    const props =
      (initExpr.type as { kind: "dynobj"; props?: { name: string; type: HIRType }[] }).props || [];
    const tmpId = freshId();
    const tmpName = `__destruct_${tmpId}`;
    locals.set(tmpName, { id: tmpId, type: initExpr.type, mutable: false });
    stmts.push({
      kind: "let",
      id: tmpId,
      name: tmpName,
      type: initExpr.type,
      init: initExpr,
      mutable: false,
    } as HIRStmt);

    for (const { fieldName, localName, span } of resolveObjectDestructProps(d.id.properties)) {
      const propInfo = props.find((p) => p.name === fieldName);
      const propType = propInfo ? propInfo.type : DYNOBJ;
      const elemId = freshId();
      const key: HIRExpr = { kind: "literal_string", value: fieldName, type: I8PTR };
      const fieldGet = dynObjGetForType(
        { kind: "local_get", id: tmpId, type: initExpr.type },
        key,
        propType,
      );

      locals.set(localName, { id: elemId, type: propType, mutable });
      stmts.push({
        kind: "let",
        id: elemId,
        name: localName,
        type: propType,
        init: fieldGet,
        mutable,
      } as HIRStmt);
    }

    return stmts;
  }

  if (initExpr.type.kind !== "ptr")
    compileError("object destructuring requires struct/class/object type", d.span);

  const typeName = (initExpr.type as { kind: "ptr"; pointee: string }).pointee;
  const classInfo = classRegistry.get(typeName);
  if (!classInfo) compileError(`object destructuring: unknown class '${typeName}'`, d.span);

  const tmpId = freshId();
  const tmpName = `__destruct_${tmpId}`;
  locals.set(tmpName, { id: tmpId, type: initExpr.type, mutable: false });
  stmts.push({
    kind: "let",
    id: tmpId,
    name: tmpName,
    type: initExpr.type,
    init: initExpr,
    mutable: false,
  } as HIRStmt);

  for (const { fieldName, localName, span } of resolveObjectDestructProps(d.id.properties)) {
    const fieldIdx = classInfo!.fields.findIndex((f) => f.name === fieldName);
    if (fieldIdx < 0) compileError(`property '${fieldName}' does not exist on '${typeName}'`, span);

    const field = classInfo!.fields[fieldIdx];
    const elemId = freshId();
    const fieldGet: HIRExpr = {
      kind: "field_get",
      object: { kind: "local_get", id: tmpId, type: initExpr.type },
      fieldName,
      index: fieldIdx,
      type: field.type,
    };

    locals.set(localName, { id: elemId, type: field.type, mutable });
    stmts.push({
      kind: "let",
      id: elemId,
      name: localName,
      type: field.type,
      init: fieldGet,
      mutable,
    } as HIRStmt);
  }

  return stmts;
}

function lowerReturn(stmt: ReturnStatement): HIRStmt {
  let value: HIRExpr | undefined;
  if (stmt.argument) {
    if (currentReturnType && currentReturnType.kind === "ptr") {
      setExpectedDeclType(currentReturnType);
      value = lowerExpr(stmt.argument);
      setExpectedDeclType(null);
    } else if (currentReturnType && currentReturnType.kind === "array") {
      setExpectedArrayElementType((currentReturnType as { kind: "array"; element: HIRType }).element);
      setExpectedDeclType(currentReturnType);
      value = lowerExpr(stmt.argument);
      setExpectedDeclType(null);
      setExpectedArrayElementType(null);
    } else {
      value = lowerExpr(stmt.argument);
    }
  }
  return { kind: "return", value };
}

function detectNarrowing(test: any): { varName: string; fieldName: string; literal: string } | null {
  if (
    test.type === "BinaryExpression" &&
    (test.operator === "===" || test.operator === "==") &&
    test.left?.type === "MemberExpression" &&
    test.left.object?.type === "Identifier" &&
    test.left.property?.type === "Identifier" &&
    test.right?.type === "StringLiteral"
  ) {
    return {
      varName: test.left.object.value,
      fieldName: test.left.property.value,
      literal: test.right.value,
    };
  }
  return null;
}

function findVariant(
  baseType: import("./types.js").HIRType,
  fieldName: string,
  literal: string,
): import("./types.js").HIRType | null {
  if (baseType.kind !== "dynobj" || !baseType.variants) return null;
  for (const variant of baseType.variants) {
    if (variant.literals[fieldName] === literal) {
      return { kind: "dynobj", props: variant.fields };
    }
  }
  return null;
}

function lowerIf(stmt: IfStatement): HIRStmt {
  const condition = coerceToCondition(lowerExpr(stmt.test));
  const narrowing = detectNarrowing(stmt.test);
  let narrowedName: string | null = null;

  if (narrowing) {
    const local = locals.get(narrowing.varName);
    if (local) {
      const narrowed = findVariant(local.type, narrowing.fieldName, narrowing.literal);
      if (narrowed) {
        narrowedName = narrowing.varName;
        pushNarrowing(narrowing.varName, narrowed);
      }
    }
  }

  const thenBody = lowerConsequent(stmt.consequent);
  if (narrowedName) popNarrowing(narrowedName);

  return {
    kind: "if",
    condition,
    then: thenBody,
    else: stmt.alternate ? lowerConsequent(stmt.alternate) : undefined,
  };
}

function lowerConsequent(stmt: Statement): HIRStmt[] {
  if (stmt.type === "BlockStatement") return lowerBlock(stmt);
  return lowerModuleItem(stmt as ModuleItem);
}

function lowerWhile(stmt: WhileStatement): HIRStmt {
  return {
    kind: "while",
    condition: coerceToCondition(lowerExpr(stmt.test)),
    body: lowerConsequent(stmt.body),
  };
}

function lowerFor(stmt: ForStatement): HIRStmt {
  const init = stmt.init
    ? stmt.init.type === "VariableDeclaration"
      ? lowerVarDecl(stmt.init)[0]
      : { kind: "expr" as const, expr: lowerExpr(stmt.init as Expression) }
    : undefined;

  return {
    kind: "for",
    init,
    condition: stmt.test ? coerceToCondition(lowerExpr(stmt.test)) : undefined,
    update: stmt.update ? lowerExpr(stmt.update) : undefined,
    body: lowerConsequent(stmt.body),
  };
}

function lowerDoWhile(stmt: any): HIRStmt {
  return {
    kind: "for",
    init: undefined,
    condition: undefined,
    update: undefined,
    body: [
      ...lowerConsequent(stmt.body),
      {
        kind: "if",
        condition: {
          kind: "unary",
          op: "not",
          operand: lowerExpr(stmt.test),
          type: I1,
        },
        then: [{ kind: "break" as const }],
      },
    ],
  };
}

function lowerSwitch(stmt: any): HIRStmt {
  const allStringCases = stmt.cases.every((c: any) =>
    !c.test || c.test.type === "StringLiteral"
  );
  if (allStringCases) setExpectedDeclType(I8PTR);
  const discriminant = lowerExpr(stmt.discriminant);
  if (allStringCases) setExpectedDeclType(null);
  const cases: import("./types.js").HIRSwitchCase[] = stmt.cases.map((c: any) => ({
    test: c.test ? lowerExpr(c.test) : undefined,
    body: c.consequent.flatMap((s: any) => lowerModuleItem(s)),
  }));
  return { kind: "switch", discriminant, cases };
}

function lowerThrow(stmt: any): HIRStmt {
  let value = lowerExpr(stmt.argument);
  if (
    stmt.argument.type === "NewExpression" &&
    stmt.argument.callee?.type === "Identifier" &&
    stmt.argument.callee.value === "Error" &&
    stmt.argument.arguments?.length >= 1
  ) {
    value = lowerExpr(stmt.argument.arguments[0].expression);
  }
  if (value.type.kind !== "i8ptr") {
    value = {
      kind: "runtime_call",
      func: "cs2_format_number_to_str",
      args: [value],
      returnType: I8PTR,
      type: I8PTR,
    };
  }
  return { kind: "throw", value };
}

function lowerTry(stmt: any): HIRStmt {
  const body = lowerBlock(stmt.block);
  let catchClause: { paramId: number; paramName: string; body: HIRStmt[] } | undefined;
  if (stmt.handler) {
    const paramName = stmt.handler.param?.value || "__err";
    const paramId = freshId();
    locals.set(paramName, { id: paramId, type: I8PTR, mutable: false });
    const catchBody = lowerBlock(stmt.handler.body);
    catchClause = { paramId, paramName, body: catchBody };
  }
  let finallyBody: HIRStmt[] | undefined;
  if (stmt.finalizer) {
    finallyBody = lowerBlock(stmt.finalizer);
  }
  return { kind: "try", body, catch: catchClause, finally: finallyBody };
}

function lowerForOf(stmt: any): HIRStmt[] {
  let iteree = lowerExpr(stmt.right);

  if (iteree.type.kind === "boxed") {
    iteree = coerce(iteree, DYNARRAY);
  }

  if (iteree.type.kind === "map") {
    return lowerForOfMap(stmt, iteree);
  }

  if (iteree.type.kind === "dynarray" || iteree.type.kind === "dynobj") {
    return lowerForOfDynarray(stmt, iteree);
  }

  if (iteree.type.kind !== "array") {
    compileError(`for...of requires array or map type, got ${iteree.type.kind}`, stmt.span);
  }

  const elemType = (iteree.type as { kind: "array"; element: HIRType }).element;
  const lenFn = `${arrayPrefix(elemType)}_length`;

  const iId = freshId();
  const arrId = freshId();
  locals.set("__forof_arr", { id: arrId, type: iteree.type, mutable: false });
  locals.set("__forof_i", { id: iId, type: I64, mutable: true });

  const arrStore: HIRStmt = {
    kind: "let",
    id: arrId,
    name: "__forof_arr",
    type: iteree.type,
    init: iteree,
    mutable: false,
  };
  const iInit: HIRStmt = {
    kind: "let",
    id: iId,
    name: "__forof_i",
    type: I64,
    init: { kind: "literal_i64", value: 0, type: I64 },
    mutable: true,
  };

  const lenExpr: HIRExpr = {
    kind: "runtime_call",
    func: lenFn,
    args: [{ kind: "local_get", id: arrId, type: iteree.type }],
    returnType: I64,
    type: I64,
  };

  const condition: HIRExpr = {
    kind: "binary",
    op: "lt",
    left: { kind: "local_get", id: iId, type: I64 },
    right: lenExpr,
    type: I1,
  };

  const indexGet: HIRExpr = {
    kind: "index_get",
    array: { kind: "local_get", id: arrId, type: iteree.type },
    index: { kind: "local_get", id: iId, type: I64 },
    type: elemType,
  };

  const varDecl = stmt.left;
  const declId = varDecl.declarations[0].id;
  const elemId = freshId();
  const bodyStmts: HIRStmt[] = [];

  if (declId.type === "ObjectPattern") {
    locals.set("__forof_elem", { id: elemId, type: elemType, mutable: false });
    bodyStmts.push({ kind: "let", id: elemId, name: "__forof_elem", type: elemType, init: indexGet, mutable: false });
    const elemGetExpr: HIRExpr = { kind: "local_get", id: elemId, type: elemType };
    const props = (elemType as any).props as { name: string; type: HIRType }[] | undefined;
    for (const prop of declId.properties) {
      const fieldName: string = prop.key?.value ?? prop.value?.value;
      const localName: string = prop.value?.value ?? fieldName;
      const propInfo = props?.find((p: { name: string }) => p.name === fieldName);
      const propType: HIRType = propInfo?.type ?? BOXED;
      const propId = freshId();
      locals.set(localName, { id: propId, type: propType, mutable: false });
      const func = propType.kind === "i8ptr" ? "cs2_dynobj_get_str"
                 : propType.kind === "f64" || propType.kind === "i64" ? "cs2_dynobj_get_f64"
                 : propType.kind === "i1" ? "cs2_dynobj_get_bool"
                 : "cs2_dynobj_get_obj";
      const retType = propType.kind === "i8ptr" ? I8PTR
                    : propType.kind === "f64" || propType.kind === "i64" ? F64
                    : propType.kind === "i1" ? I1
                    : propType;
      const dynInit: HIRExpr = elemType.kind === "dynobj" || elemType.kind === "boxed"
        ? { kind: "runtime_call", func, args: [elemGetExpr, { kind: "literal_string", value: fieldName, type: I8PTR }], returnType: retType, type: retType }
        : { kind: "runtime_call", func, args: [elemGetExpr, { kind: "literal_string", value: fieldName, type: I8PTR }], returnType: retType, type: retType };
      bodyStmts.push({ kind: "let", id: propId, name: localName, type: propType, init: dynInit, mutable: false });
    }
  } else if (declId.type === "ArrayPattern") {
    locals.set("__forof_elem", { id: elemId, type: elemType, mutable: false });
    bodyStmts.push({ kind: "let", id: elemId, name: "__forof_elem", type: elemType, init: indexGet, mutable: false });
    const elemGetExpr: HIRExpr = { kind: "local_get", id: elemId, type: elemType };
    const innerElemType = elemType.kind === "array" ? (elemType as { kind: "array"; element: HIRType }).element : BOXED;
    for (let pi = 0; pi < declId.elements.length; pi++) {
      const pat = declId.elements[pi];
      if (!pat) continue;
      const patName: string = pat.type === "Identifier" ? pat.value : `__pat${pi}`;
      const patId = freshId();
      locals.set(patName, { id: patId, type: innerElemType, mutable: false });
      const patInit: HIRExpr = {
        kind: "index_get",
        array: elemGetExpr,
        index: { kind: "literal_i64", value: pi, type: I64 },
        type: innerElemType,
      };
      bodyStmts.push({ kind: "let", id: patId, name: patName, type: innerElemType, init: patInit, mutable: false });
    }
  } else {
    const varName: string = declId.value;
    locals.set(varName, { id: elemId, type: elemType, mutable: false });
    bodyStmts.push({ kind: "let", id: elemId, name: varName, type: elemType, init: indexGet, mutable: false });
  }

  const innerBody = lowerConsequent(stmt.body);

  const update: HIRExpr = {
    kind: "local_set",
    id: iId,
    value: {
      kind: "binary",
      op: "add",
      left: { kind: "local_get", id: iId, type: I64 },
      right: { kind: "literal_i64", value: 1, type: I64 },
      type: I64,
    },
    type: I64,
  };

  const forStmt: HIRStmt = {
    kind: "for",
    init: undefined,
    condition,
    update,
    body: [...bodyStmts, ...innerBody],
  };

  return [arrStore, iInit, forStmt];
}

function lowerForOfDynarray(stmt: any, iteree: HIRExpr): HIRStmt[] {
  const arrType: HIRType = { kind: "dynarray" };
  let actualArr: HIRExpr;
  if (iteree.type.kind === "dynobj") {
    if ((iteree as any).kind === "runtime_call" && (iteree as any).func === "cs2_dynobj_get_obj") {
      actualArr = { ...(iteree as any), func: "cs2_dynobj_get_arr", returnType: arrType, type: arrType };
    } else {
      actualArr = { ...iteree, type: arrType };
    }
  } else {
    actualArr = iteree;
  }

  const iId = freshId();
  const arrId = freshId();
  locals.set("__forof_darr", { id: arrId, type: arrType, mutable: false });
  locals.set("__forof_i", { id: iId, type: I64, mutable: true });

  const arrStore: HIRStmt = {
    kind: "let",
    id: arrId,
    name: "__forof_darr",
    type: arrType,
    init: actualArr,
    mutable: false,
  };
  const iInit: HIRStmt = {
    kind: "let",
    id: iId,
    name: "__forof_i",
    type: I64,
    init: { kind: "literal_i64", value: 0, type: I64 },
    mutable: true,
  };

  const lenExpr: HIRExpr = {
    kind: "runtime_call",
    func: "cs2_dynarray_length",
    args: [{ kind: "local_get", id: arrId, type: arrType }],
    returnType: I64,
    type: I64,
  };

  const condition: HIRExpr = {
    kind: "binary",
    op: "lt",
    left: { kind: "local_get", id: iId, type: I64 },
    right: lenExpr,
    type: I1,
  };

  const indexGet: HIRExpr = {
    kind: "runtime_call",
    func: "cs2_dynarray_get_obj",
    args: [
      { kind: "local_get", id: arrId, type: arrType },
      { kind: "local_get", id: iId, type: I64 },
    ],
    returnType: DYNOBJ,
    type: DYNOBJ,
  };

  const varDecl = stmt.left;
  const declId = varDecl.declarations[0].id;
  const elemId = freshId();
  const dynarrBodyStmts: HIRStmt[] = [];

  if (declId.type === "ObjectPattern") {
    locals.set("__forof_elem", { id: elemId, type: DYNOBJ, mutable: false });
    dynarrBodyStmts.push({ kind: "let", id: elemId, name: "__forof_elem", type: DYNOBJ, init: indexGet, mutable: false });
    const elemGetExpr: HIRExpr = { kind: "local_get", id: elemId, type: DYNOBJ };
    for (const prop of declId.properties) {
      const fieldName: string = prop.key?.value ?? prop.value?.value;
      const localName: string = prop.value?.value ?? fieldName;
      const propId = freshId();
      locals.set(localName, { id: propId, type: DYNOBJ, mutable: false });
      dynarrBodyStmts.push({
        kind: "let", id: propId, name: localName, type: DYNOBJ, mutable: false,
        init: { kind: "runtime_call", func: "cs2_dynobj_get_obj", args: [elemGetExpr, { kind: "literal_string", value: fieldName, type: I8PTR }], returnType: DYNOBJ, type: DYNOBJ },
      });
    }
  } else {
    const varName: string = declId.value;
    locals.set(varName, { id: elemId, type: DYNOBJ, mutable: false });
    dynarrBodyStmts.push({ kind: "let", id: elemId, name: varName, type: DYNOBJ, init: indexGet, mutable: false });
  }

  const innerBody = lowerConsequent(stmt.body);

  const update: HIRExpr = {
    kind: "local_set",
    id: iId,
    value: {
      kind: "binary",
      op: "add",
      left: { kind: "local_get", id: iId, type: I64 },
      right: { kind: "literal_i64", value: 1, type: I64 },
      type: I64,
    },
    type: I64,
  };

  return [
    arrStore,
    iInit,
    { kind: "for", init: undefined, condition, update, body: [...dynarrBodyStmts, ...innerBody] },
  ];
}

function lowerForOfMap(stmt: any, mapExpr: HIRExpr): HIRStmt[] {
  const mt = mapExpr.type as { kind: "map"; key: HIRType; value: HIRType };
  const prefix = mapPrefix(mt.key, mt.value);

  const mapId = freshId();
  const iId = freshId();
  locals.set("__forof_map", { id: mapId, type: mapExpr.type, mutable: false });
  locals.set("__forof_i", { id: iId, type: I64, mutable: true });

  const mapStore: HIRStmt = {
    kind: "let",
    id: mapId,
    name: "__forof_map",
    type: mapExpr.type,
    init: mapExpr,
    mutable: false,
  };
  const iInit: HIRStmt = {
    kind: "let",
    id: iId,
    name: "__forof_i",
    type: I64,
    init: { kind: "literal_i64", value: 0, type: I64 },
    mutable: true,
  };

  const sizeExpr: HIRExpr = {
    kind: "runtime_call",
    func: `${prefix}_size`,
    args: [{ kind: "local_get", id: mapId, type: mapExpr.type }],
    returnType: I64,
    type: I64,
  };

  const condition: HIRExpr = {
    kind: "binary",
    op: "lt",
    left: { kind: "local_get", id: iId, type: I64 },
    right: sizeExpr,
    type: I1,
  };

  const varDecl = stmt.left;
  const declId = varDecl.declarations[0].id;
  const bodyVars: HIRStmt[] = [];

  if (declId.type === "ArrayPattern" && declId.elements.length === 2) {
    if (declId.elements[0]) {
      const keyName = declId.elements[0].value;
      const keyId = freshId();
      locals.set(keyName, { id: keyId, type: mt.key, mutable: false });
      bodyVars.push({
        kind: "let",
        id: keyId,
        name: keyName,
        type: mt.key,
        init: {
          kind: "runtime_call",
          func: `${prefix}_key_at`,
          args: [
            { kind: "local_get", id: mapId, type: mapExpr.type },
            { kind: "local_get", id: iId, type: I64 },
          ],
          returnType: mt.key,
          type: mt.key,
        },
        mutable: false,
      });
    }
    if (declId.elements[1]) {
      const valName = declId.elements[1].value;
      const valId = freshId();
      locals.set(valName, { id: valId, type: mt.value, mutable: false });
      bodyVars.push({
        kind: "let",
        id: valId,
        name: valName,
        type: mt.value,
        init: {
          kind: "runtime_call",
          func: `${prefix}_value_at`,
          args: [
            { kind: "local_get", id: mapId, type: mapExpr.type },
            { kind: "local_get", id: iId, type: I64 },
          ],
          returnType: mt.value,
          type: mt.value,
        },
        mutable: false,
      });
    }
  } else {
    compileError("for...of over Map requires [key, value] destructuring", stmt.span);
  }

  const innerBody = lowerConsequent(stmt.body);

  const update: HIRExpr = {
    kind: "local_set",
    id: iId,
    value: {
      kind: "binary",
      op: "add",
      left: { kind: "local_get", id: iId, type: I64 },
      right: { kind: "literal_i64", value: 1, type: I64 },
      type: I64,
    },
    type: I64,
  };

  const forStmt: HIRStmt = {
    kind: "for",
    init: undefined,
    condition,
    update,
    body: [...bodyVars, ...innerBody],
  };

  return [mapStore, iInit, forStmt];
}
