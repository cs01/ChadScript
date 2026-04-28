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
  SourceInfo,
} from "./types.js";
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
  isModuleScope,
  expectedArrayElementType,
  nextAnonId,
  freshId,
  setNextId,
  setIsModuleScope,
  setExpectedArrayElementType,
  setExpectedMapType,
  setExpectedDeclType,
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
} from "./lower-state.js";
import {
  registerFunction,
  registerInterface,
  registerClass,
  lowerClassDecl,
} from "./lower-class.js";
import { lowerExpr, drainPendingGenericClasses } from "./lower-expr.js";
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
): HIRModule {
  const functions: HIRFunction[] = [];
  const hirClasses: import("./types.js").HIRClass[] = [];
  const hirInterfaces: import("./types.js").HIRInterface[] = [];
  const hirGlobals: import("./types.js").HIRGlobal[] = [];
  const init: HIRStmt[] = [];

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
  setSourceText(source || "");
  setLineOffsets(buildLineOffsets(source || ""));

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

  for (const item of ast.body) {
    const inner = unwrapExport(item);
    if ((inner as any).type === "TsInterfaceDeclaration") {
      registerInterface(inner as any);
    }
  }

  for (const item of ast.body) {
    const inner = unwrapExport(item) as any;
    if (inner.type === "TsTypeAliasDeclaration" && inner.id?.type === "Identifier") {
      const name = inner.id.value;
      const resolved = resolveTypeAnnotation(inner.typeAnnotation);
      typeAliasRegistry.set(name, resolved);
    }
  }

  for (const item of ast.body) {
    const inner = unwrapExport(item);
    if (inner.type === "ClassDeclaration") {
      if (isGenericClass(inner as any)) {
        storeGenericClassTemplate(inner as any);
      } else {
        registerClass(inner as any);
      }
    }
  }

  for (const item of ast.body) {
    const inner = unwrapExport(item);
    if (inner.type === "FunctionDeclaration") {
      if (isGenericFunction(inner as any)) {
        storeGenericFunctionTemplate(inner as any);
      } else {
        registerFunction(inner);
      }
    }
  }

  for (const item of ast.body) {
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

  for (const item of ast.body) {
    const inner = unwrapExport(item);
    if (inner.type === "ImportDeclaration") {
      continue;
    } else if ((inner as any).type === "TsInterfaceDeclaration") {
      continue;
    } else if ((inner as any).type === "TsEnumDeclaration") {
      continue;
    } else if ((inner as any).type === "TsTypeAliasDeclaration") {
      continue;
    } else if (inner.type === "ClassDeclaration") {
      if (isGenericClass(inner as any)) continue;
      const { hirClass, fns } = lowerClassDecl(inner as any);
      hirClasses.push(hirClass);
      functions.push(...fns);
    } else if (inner.type === "FunctionDeclaration") {
      if (isGenericFunction(inner as any)) continue;
      setIsModuleScope(false);
      functions.push(lowerFunctionDecl(inner));
      setIsModuleScope(true);
    } else if (inner.type === "VariableDeclaration") {
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
          if (initExpr.type.kind !== "ptr")
            compileError("object destructuring requires struct/class type", d.span);

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
    } else {
      const stmts = lowerModuleItem(inner);
      init.push(...stmts);
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

  return {
    functions,
    classes: hirClasses,
    interfaces: hirInterfaces,
    globals: hirGlobals,
    init,
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

function lowerObjectDestructuring(d: any, mutable: boolean): HIRStmt[] {
  const stmts: HIRStmt[] = [];
  if (!d.init) compileError("object destructuring requires initializer", d.span);

  const initExpr = lowerExpr(d.init);
  if (initExpr.type.kind !== "ptr")
    compileError("object destructuring requires struct/class type", d.span);

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
  return {
    kind: "return",
    value: stmt.argument ? lowerExpr(stmt.argument) : undefined,
  };
}

function lowerIf(stmt: IfStatement): HIRStmt {
  return {
    kind: "if",
    condition: coerceToCondition(lowerExpr(stmt.test)),
    then: lowerConsequent(stmt.consequent),
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
  const discriminant = lowerExpr(stmt.discriminant);
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
  const iteree = lowerExpr(stmt.right);

  if (iteree.type.kind === "map") {
    return lowerForOfMap(stmt, iteree);
  }

  if (iteree.type.kind !== "array") {
    compileError("for...of requires array or map type", stmt.span);
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
  const varName = varDecl.declarations[0].id.value;
  const elemId = freshId();
  locals.set(varName, { id: elemId, type: elemType, mutable: false });

  const elemLet: HIRStmt = {
    kind: "let",
    id: elemId,
    name: varName,
    type: elemType,
    init: indexGet,
    mutable: false,
  };
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
    body: [elemLet, ...innerBody],
  };

  return [arrStore, iInit, forStmt];
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
    const keyName = declId.elements[0].value;
    const valName = declId.elements[1].value;
    const keyId = freshId();
    const valId = freshId();
    locals.set(keyName, { id: keyId, type: mt.key, mutable: false });
    locals.set(valName, { id: valId, type: mt.value, mutable: false });

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
