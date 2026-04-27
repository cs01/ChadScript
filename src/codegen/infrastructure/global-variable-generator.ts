import type {
  AST,
  Expression,
  CallNode,
  VariableNode,
  VariableDeclaration,
  ObjectNode,
  MethodCallNode,
  InterfaceDeclaration,
  InterfaceField,
  NewNode,
  IndexAccessNode,
  MapNode,
  SourceLocation,
} from "../../ast/types.js";
import {
  SymbolKind_Number,
  SymbolKind_String,
  SymbolKind_Boolean,
  SymbolKind_Array,
  SymbolKind_StringArray,
  SymbolKind_ObjectArray,
  SymbolKind_Object,
  SymbolKind_Map,
  SymbolKind_Set,
  SymbolKind_Class,
  SymbolKind_Regex,
  SymbolKind_JSON,
  SymbolKind_Uint8Array,
  SymbolKind_Url,
  SymbolKind_UrlSearchParams,
} from "./base-generator.js";
import {
  type SymbolMetadata,
  type Symbol,
  createPointerAllocaMetadata,
  createClassMetadata,
  createObjectMetadataWithInterface,
  createInterfaceMetadata,
  createMapMetadataSymbol,
  createSetMetadataSymbol,
} from "./symbol-table.js";
import { stripOptional, stripNullable, tsTypeToLlvm } from "./type-system.js";
import {
  parseTypeString,
  parseMapTypeString,
  isObjectArrayTsType,
  isAnyArrayTsType,
  classifyArray,
  arrayKindToLlvm,
  arrayElementType,
  ArrayKind_None,
  ArrayKind_String,
  ArrayKind_Number,
  ArrayKind_Boolean,
  ArrayKind_Object,
  type ResolvedType,
} from "./type-system.js";
import { findI64EligibleVariables } from "./integer-analysis.js";

export interface GlobalVarContext {
  ast: AST;
  topLevelStatementsCount: number;

  semaSymbolCount: number;
  semaSymbolNames: string[];
  semaSymbolTypes: string[];
  semaSymbolSchemaKeys: (string[] | undefined)[];
  semaSymbolSchemaTypes: (string[] | undefined)[];

  globalVarSet(name: string, entry: { llvmType: string; kind: number; initialized: boolean }): void;
  globalVarGet(name: string): { llvmType: string; kind: number; initialized: boolean } | undefined;

  defineVariable(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
  ): void;
  defineVariableWithMetadata(
    name: string,
    allocaReg: string,
    llvmType: string,
    kind: number,
    scope: string,
    metadata: SymbolMetadata,
  ): void;

  symbolTableLookup(name: string): Symbol | undefined;
  symbolTableDefineUrl(name: string, allocaReg: string, scope: string): void;
  symbolTableDefineUrlSearchParams(name: string, allocaReg: string, scope: string): void;
  symbolTableGetObjectArrayElementType(name: string): string | undefined;
  symbolTableGetRawInterfaceType(name: string): string | undefined;
  symbolTableSetRawInterfaceType(name: string, type: string): void;
  symbolTableGetResolvedType(name: string): ResolvedType | undefined;
  symbolTableSetResolvedType(name: string, type: ResolvedType): void;
  symbolTableMarkLLVMConstant(name: string): void;

  typeResolverGetInterface(name: string): InterfaceDeclaration | null;

  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  typeOf(expr: Expression): ResolvedType | null;
  resolveImportAlias(localName: string): string;
  isKnownClass(name: string): boolean;
  getInterfaceDeclByName(name: string): InterfaceDeclaration | null;
  getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[];
  getInterfaceProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  isTypeAlias(name: string): boolean;
  getTypeAliasCommonProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  tsTypeToLlvmJsonWithEnums(tsType: string): string;
  getGenericMethodReturnError(expr: MethodCallNode, varName: string): string | null;
  getIndexAccessClassName(expr: Expression): string | null;
  getMemberAccessClassName(expr: Expression): string | null;
  getObjectMetadata(
    objExpr: ObjectNode,
    targetInterface?: string,
  ): { keys: string[]; types: string[] };
  classGenGetClassFields(name: string): { name: string; fieldType: string }[];
  typeInferenceGetJSONParseInterface(mc: MethodCallNode): string | null;
  typeInferenceGetFunctionCallInterfaceReturn(value: Expression): string | null;
  typeInferenceGetIndexAccessElementType(value: Expression): string | null;
  typeInferenceIsObjectArrayExpression(value: Expression): boolean;
  typeInferenceIsUint8ArrayExpression(value: Expression): boolean;
  typeInferenceIsJSONParseExpression(value: Expression): boolean;
  typeInferenceGetObjectArrayElementType(value: Expression): string | null;
}

export function prePopulateFromSema(ctx: GlobalVarContext): void {
  if (ctx.semaSymbolCount === 0) return;

  const topLevelNames: string[] = [];
  for (let i = 0; i < ctx.topLevelStatementsCount; i++) {
    const stmt = ctx.ast.topLevelStatements[i];
    if (stmt.type === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.name) {
        topLevelNames.push(decl.name);
      }
    }
  }

  for (let ti = 0; ti < topLevelNames.length; ti++) {
    const name = topLevelNames[ti];
    if (
      name === "console" ||
      name === "process" ||
      name === "Math" ||
      name === "JSON" ||
      name === "Date"
    )
      continue;

    let semaIdx: number = -1;
    for (let si = 0; si < ctx.semaSymbolCount; si++) {
      if (ctx.semaSymbolNames[si] === name) {
        semaIdx = si;
        break;
      }
    }
    if (semaIdx === -1) continue;

    const stype = ctx.semaSymbolTypes[semaIdx];
    if (stype === "null" || stype === "undefined" || stype === "unknown") continue;

    let kind: number = -1;
    let llvmType = "";

    if (stype === "number") {
      kind = SymbolKind_Number;
      llvmType = "double";
    } else if (stype === "string") {
      kind = SymbolKind_String;
      llvmType = "i8*";
    } else if (stype === "boolean") {
      kind = SymbolKind_Boolean;
      llvmType = "double";
    } else if (stype === "array<number>") {
      kind = SymbolKind_Array;
      llvmType = "%Array*";
    } else if (stype === "array<string>") {
      kind = SymbolKind_StringArray;
      llvmType = "%StringArray*";
    } else if (stype === "object") {
      kind = SymbolKind_Object;
      llvmType = "i8*";
    } else if (stype === "class") {
      kind = SymbolKind_Class;
      llvmType = "i8*";
    }

    if (kind === -1) continue;

    const schemaKeys = ctx.semaSymbolSchemaKeys[semaIdx];
    const schemaTypes = ctx.semaSymbolSchemaTypes[semaIdx];
    if (stype === "object" && schemaKeys && schemaTypes) {
      const metadata: SymbolMetadata = {
        objectMetadata: { keys: schemaKeys, types: schemaTypes },
        classMetadata: undefined,
        arrayMetadata: undefined,
        objectArrayMetadata: undefined,
        closureMetadata: undefined,
        mapMetadata: undefined,
        setMetadata: undefined,
        isPointerAlloca: undefined,
        interfaceType: undefined,
        resolvedType: undefined,
        unionType: undefined,
        unionMembers: undefined,
      };
      ctx.defineVariableWithMetadata(name, "", llvmType, kind, "global", metadata);
    } else {
      ctx.defineVariable(name, "", llvmType, kind, "global");
    }
  }
}

export function tryHandleGlobalCallReturn(
  ctx: GlobalVarContext,
  name: string,
  callNode: CallNode,
): string {
  for (let fi = 0; fi < ctx.ast.functions.length; fi++) {
    const fn = ctx.ast.functions[fi];
    if (!fn) continue;
    if (fn.name === callNode.name && fn.returnType) {
      let rt = fn.returnType;
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        if (callNode.typeArgs && callNode.typeArgs.length > 0) {
          for (let ti = 0; ti < fn.typeParameters.length; ti++) {
            const tp = fn.typeParameters[ti] || "";
            const ta = callNode.typeArgs[ti] || "any";
            rt = rt.split(tp).join(ta);
          }
        } else {
          for (let ti = 0; ti < fn.typeParameters.length; ti++) {
            const tp = fn.typeParameters[ti] || "";
            if (rt === tp) {
              rt = "string";
              break;
            }
          }
        }
      }
      if (rt === "string" || rt === "i8_ptr" || rt === "ptr") {
        ctx.globalVarSet(name, {
          llvmType: "i8*",
          kind: SymbolKind_String,
          initialized: false,
        });
        ctx.defineVariable(name, `@${name}`, "i8*", SymbolKind_String, "global");
        return `@${name} = global i8* null\n`;
      }
      const iface = ctx.getInterfaceDeclByName(rt);
      if (iface) {
        const keys: string[] = [];
        const tsTypes: string[] = [];
        const types: string[] = [];
        const allFields = ctx.getAllInterfaceFields(iface);
        for (let i = 0; i < allFields.length; i++) {
          const field = allFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          tsTypes.push(field.type);
          types.push(ctx.tsTypeToLlvmJsonWithEnums(field.type));
        }
        ctx.globalVarSet(name, {
          llvmType: "i8*",
          kind: SymbolKind_Object,
          initialized: false,
        });
        ctx.defineVariableWithMetadata(
          name,
          `@${name}`,
          "i8*",
          SymbolKind_Object,
          "global",
          createObjectMetadataWithInterface({ keys, types, tsTypes }, rt),
        );
        return `@${name} = global i8* null\n`;
      }
      if (ctx.isKnownClass(rt)) {
        const resolvedClassName = ctx.resolveImportAlias(rt);
        const fields = ctx.classGenGetClassFields(resolvedClassName);
        const llvmType = fields.length > 0 ? `%${resolvedClassName}_struct*` : "i32*";
        ctx.globalVarSet(name, {
          llvmType,
          kind: SymbolKind_Class,
          initialized: false,
        });
        ctx.defineVariableWithMetadata(
          name,
          `@${name}`,
          llvmType,
          SymbolKind_Class,
          "global",
          createClassMetadata({ className: resolvedClassName }),
        );
        return `@${name} = global ${llvmType} null\n`;
      }
      const akRt = classifyArray(rt);
      if (akRt !== ArrayKind_None) {
        const elementType = arrayElementType(rt);
        const llvmType = arrayKindToLlvm(akRt);
        if (akRt === ArrayKind_String) {
          ctx.globalVarSet(name, {
            llvmType,
            kind: SymbolKind_StringArray,
            initialized: false,
          });
          ctx.defineVariable(name, `@${name}`, llvmType, SymbolKind_StringArray, "global");
          return `@${name} = global ${llvmType} null\n`;
        }
        if (akRt === ArrayKind_Number || akRt === ArrayKind_Boolean) {
          ctx.globalVarSet(name, {
            llvmType,
            kind: SymbolKind_Array,
            initialized: false,
          });
          ctx.defineVariable(name, `@${name}`, llvmType, SymbolKind_Array, "global");
          return `@${name} = global ${llvmType} null\n`;
        }
        ctx.globalVarSet(name, {
          llvmType,
          kind: SymbolKind_ObjectArray,
          initialized: false,
        });
        ctx.defineVariableWithMetadata(
          name,
          `@${name}`,
          llvmType,
          SymbolKind_ObjectArray,
          "global",
          createInterfaceMetadata(elementType),
        );
        ctx.symbolTableSetRawInterfaceType(name, elementType);
        return `@${name} = global ${llvmType} null\n`;
      }
      if (ctx.isTypeAlias(rt)) {
        const commonProps = ctx.getTypeAliasCommonProperties(rt);
        if (commonProps) {
          ctx.globalVarSet(name, {
            llvmType: "i8*",
            kind: SymbolKind_Object,
            initialized: false,
          });
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            "i8*",
            SymbolKind_Object,
            "global",
            createObjectMetadataWithInterface(commonProps, rt),
          );
          return `@${name} = global i8* null\n`;
        }
      }
      break;
    }
  }
  return "";
}

export function tryHandleGlobalJSONParse(
  ctx: GlobalVarContext,
  name: string,
  methodCall: MethodCallNode,
): string {
  const interfaceName = ctx.typeInferenceGetJSONParseInterface(methodCall);
  if (interfaceName === "number[]") {
    const llvmType = "%Array*";
    const kind = SymbolKind_Array;
    ctx.globalVarSet(name, { llvmType, kind, initialized: false });
    ctx.defineVariableWithMetadata(
      name,
      `@${name}`,
      llvmType,
      kind,
      "global",
      createPointerAllocaMetadata(),
    );
    return `@${name} = global ${llvmType} null\n`;
  }
  if (interfaceName) {
    let interfaceDef: InterfaceDeclaration | null = null;
    for (let i = 0; i < ctx.ast.interfaces.length; i++) {
      const iface = ctx.ast.interfaces[i];
      if (!iface) continue;
      if (!iface.name) continue;
      if (iface.name === interfaceName) {
        interfaceDef = iface as InterfaceDeclaration;
        break;
      }
    }
    if (interfaceDef) {
      const llvmType = `%${interfaceName}*`;
      const kind = SymbolKind_Object;
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      const allFields = ctx.getAllInterfaceFields(interfaceDef);
      for (let i = 0; i < allFields.length; i++) {
        const field = allFields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        tsTypes.push(field.type);
        types.push(ctx.tsTypeToLlvmJsonWithEnums(field.type));
      }
      ctx.globalVarSet(name, { llvmType, kind, initialized: false });
      ctx.defineVariableWithMetadata(
        name,
        `@${name}`,
        llvmType,
        kind,
        "global",
        createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
      );
      return `@${name} = global ${llvmType} null\n`;
    }
  }
  return "";
}

export function tryHandleGlobalDeclaredType(
  ctx: GlobalVarContext,
  name: string,
  declaredType: string | undefined,
): string {
  if (!declaredType) return "";
  const strippedDeclaredType = stripNullable(declaredType);
  if (strippedDeclaredType === "string") return "";
  let foundInterface = false;
  for (let i = 0; i < ctx.ast.interfaces.length; i++) {
    const iface = ctx.ast.interfaces[i];
    if (!iface) continue;
    if (!iface.name) continue;
    if (iface.name === strippedDeclaredType) {
      foundInterface = true;
      break;
    }
  }
  if (foundInterface) {
    ctx.globalVarSet(name, {
      llvmType: "i8*",
      kind: SymbolKind_Object,
      initialized: false,
    });
    ctx.defineVariableWithMetadata(
      name,
      `@${name}`,
      "i8*",
      SymbolKind_Object,
      "global",
      createInterfaceMetadata(strippedDeclaredType),
    );
    return `@${name} = global i8* null\n`;
  }
  if (ctx.isKnownClass(strippedDeclaredType)) {
    const fields = ctx.classGenGetClassFields(strippedDeclaredType);
    const llvmType = fields.length > 0 ? `%${strippedDeclaredType}_struct*` : "i8*";
    ctx.globalVarSet(name, {
      llvmType,
      kind: SymbolKind_Class,
      initialized: false,
    });
    ctx.defineVariableWithMetadata(
      name,
      `@${name}`,
      llvmType,
      SymbolKind_Class,
      "global",
      createClassMetadata({ className: strippedDeclaredType }),
    );
    return `@${name} = global ${llvmType} null\n`;
  }
  if (ctx.ast.typeAliases) {
    for (let i = 0; i < ctx.ast.typeAliases.length; i++) {
      const alias = ctx.ast.typeAliases[i];
      if (!alias || alias.name !== strippedDeclaredType) continue;
      const members = alias.unionMembers;
      let aliasLlvm = "i8*";
      if (members && members.length > 0) {
        aliasLlvm = tsTypeToLlvm(members[0].trim());
      }
      const kind = aliasLlvm === "double" ? SymbolKind_Number : SymbolKind_Object;
      const defaultValue = aliasLlvm === "double" ? "0.0" : "null";
      ctx.globalVarSet(name, {
        llvmType: aliasLlvm,
        kind,
        initialized: false,
      });
      ctx.defineVariable(name, `@${name}`, aliasLlvm, kind, "global");
      return `@${name} = global ${aliasLlvm} ${defaultValue}\n`;
    }
  }
  return "";
}

export function tryHandleGlobalExpressionType(
  ctx: GlobalVarContext,
  name: string,
  value: Expression | null,
): string {
  if (!value) return "";
  const funcReturnInterface = ctx.typeInferenceGetFunctionCallInterfaceReturn(value);
  if (funcReturnInterface) {
    ctx.globalVarSet(name, {
      llvmType: "i8*",
      kind: SymbolKind_Object,
      initialized: false,
    });
    ctx.defineVariableWithMetadata(
      name,
      `@${name}`,
      "i8*",
      SymbolKind_Object,
      "global",
      createInterfaceMetadata(funcReturnInterface),
    );
    return `@${name} = global i8* null\n`;
  }
  const indexAccessInterface = ctx.typeInferenceGetIndexAccessElementType(value);
  if (indexAccessInterface) {
    ctx.globalVarSet(name, {
      llvmType: "i8*",
      kind: SymbolKind_Object,
      initialized: false,
    });
    ctx.defineVariableWithMetadata(
      name,
      `@${name}`,
      "i8*",
      SymbolKind_Object,
      "global",
      createInterfaceMetadata(indexAccessInterface),
    );
    return `@${name} = global i8* null\n`;
  }
  if ((value as { type: string }).type === "index_access") {
    const idxNode = value as IndexAccessNode;
    if (idxNode.object && idxNode.object.type === "variable") {
      const idxObjVar = idxNode.object as VariableNode;
      if (idxObjVar.name) {
        const arrSym = ctx.symbolTableLookup(idxObjVar.name);
        if (arrSym && arrSym.kind === SymbolKind_ObjectArray && arrSym.interfaceType) {
          ctx.globalVarSet(name, {
            llvmType: "i8*",
            kind: SymbolKind_Object,
            initialized: false,
          });
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            "i8*",
            SymbolKind_Object,
            "global",
            createInterfaceMetadata(arrSym.interfaceType),
          );
          return `@${name} = global i8* null\n`;
        }
      }
    }
  }
  return "";
}

export function classifyGlobalCatchAll(
  ctx: GlobalVarContext,
  name: string,
  value: Expression | null,
  declaredType: string | undefined,
  i64Eligible: string[],
): { llvmType: string; kind: number; defaultValue: string } | null {
  const exprNodeType = value ? (value as { type: string }).type : "";
  if (exprNodeType === "method_call" && !declaredType) {
    const genericErr = ctx.getGenericMethodReturnError(value as MethodCallNode, name);
    if (genericErr) {
      ctx.emitError(genericErr);
    }
  }
  if (exprNodeType === "variable") {
    const vn = value as VariableNode;
    const funcLen = ctx.ast.functions.length;
    for (let fi = 0; fi < funcLen; fi++) {
      if (ctx.ast.functions[fi].name === vn.name) {
        return { llvmType: "i8*", kind: SymbolKind_Object, defaultValue: "null" };
      }
    }
  }
  if (exprNodeType === "index_access" && value) {
    const idxExpr = value as IndexAccessNode;
    if (idxExpr.object && (idxExpr.object as { type: string }).type === "variable") {
      const parentName = (idxExpr.object as VariableNode).name;
      const parentGlobal = ctx.globalVarGet(parentName);
      if (parentGlobal && parentGlobal.llvmType === "%ObjectArray*") {
        const parentRawType = ctx.symbolTableGetRawInterfaceType(parentName);
        if (parentRawType && isAnyArrayTsType(parentRawType)) {
          return {
            llvmType: "%ObjectArray*",
            kind: SymbolKind_ObjectArray,
            defaultValue: "null",
          };
        }
        const parentResolved = ctx.symbolTableGetResolvedType(parentName);
        if (parentResolved && parentResolved.arrayDepth > 0) {
          const elemBase = parentResolved.base;
          const isClass = ctx.classGenGetClassFields(elemBase).length > 0;
          if (isClass) {
            if (name) {
              ctx.defineVariable(name, `@${name}`, "i8*", SymbolKind_Object, "global");
              ctx.symbolTableSetRawInterfaceType(name, elemBase);
              ctx.globalVarSet(name, {
                llvmType: "i8*",
                kind: SymbolKind_Object,
                initialized: false,
              });
            }
            return { llvmType: "i8*", kind: SymbolKind_Object, defaultValue: "null" };
          }
        }
      }
    }
  }
  if (
    exprNodeType === "number" ||
    exprNodeType === "boolean" ||
    exprNodeType === "binary" ||
    exprNodeType === "unary" ||
    exprNodeType === "method_call" ||
    exprNodeType === "call" ||
    exprNodeType === "variable" ||
    exprNodeType === "conditional" ||
    exprNodeType === "index_access" ||
    exprNodeType === "member_access"
  ) {
    const resolved = value ? ctx.typeOf(value) : null;
    if (resolved) {
      if (resolved.base === "string") {
        return { llvmType: "i8*", kind: SymbolKind_String, defaultValue: "null" };
      }
      if (resolved.base === "boolean") {
        return { llvmType: "i1", kind: SymbolKind_Boolean, defaultValue: "0" };
      }
      if (
        resolved.arrayDepth === 0 &&
        resolved.base !== "number" &&
        resolved.base !== "void" &&
        resolved.base !== "null" &&
        resolved.base !== "undefined" &&
        resolved.base !== "any" &&
        resolved.base !== "unknown" &&
        resolved.base !== "object" &&
        !resolved.base.startsWith("Map") &&
        !resolved.base.startsWith("Set") &&
        !resolved.base.startsWith("Promise") &&
        ctx.typeResolverGetInterface(resolved.base)
      ) {
        if (name) {
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            "i8*",
            SymbolKind_Object,
            "global",
            createInterfaceMetadata(resolved.base),
          );
          ctx.symbolTableSetRawInterfaceType(name, resolved.base);
          ctx.globalVarSet(name, {
            llvmType: "i8*",
            kind: SymbolKind_Object,
            initialized: false,
          });
        }
        return { llvmType: "i8*", kind: SymbolKind_Object, defaultValue: "null" };
      }
      if (
        resolved.arrayDepth === 0 &&
        resolved.base !== "number" &&
        resolved.base !== "boolean" &&
        resolved.base !== "string" &&
        resolved.base !== "void" &&
        resolved.base !== "null" &&
        resolved.base !== "undefined" &&
        resolved.base !== "any" &&
        resolved.base !== "unknown" &&
        resolved.base !== "object" &&
        !resolved.base.startsWith("Map") &&
        !resolved.base.startsWith("Set") &&
        !resolved.base.startsWith("Promise") &&
        ctx.classGenGetClassFields(resolved.base).length > 0
      ) {
        if (name) {
          ctx.defineVariable(name, `@${name}`, "i8*", SymbolKind_Object, "global");
          ctx.symbolTableSetRawInterfaceType(name, resolved.base);
          ctx.globalVarSet(name, {
            llvmType: "i8*",
            kind: SymbolKind_Object,
            initialized: false,
          });
        }
        return { llvmType: "i8*", kind: SymbolKind_Object, defaultValue: "null" };
      }
    }
    let isI64 = false;
    for (let ei = 0; ei < i64Eligible.length; ei++) {
      if (i64Eligible[ei] === name) {
        isI64 = true;
        break;
      }
    }
    if (isI64) {
      return { llvmType: "i64", kind: SymbolKind_Number, defaultValue: "0" };
    }
    return { llvmType: "double", kind: SymbolKind_Number, defaultValue: "0.0" };
  }
  return null;
}

export function tryGetConstLiteralValue(
  stmt: { kind: string; value: Expression | null; name: string },
  llvmType: string,
  i64Eligible: string[],
): { llvmType: string; value: string } | null {
  if (stmt.kind !== "const" || stmt.value === null) return null;
  const val = stmt.value as {
    type: string;
    value?: number | string | boolean;
    loc?: SourceLocation;
    isFloat?: boolean;
  };
  if (val.type === "number" && typeof val.value === "number") {
    let isI64 = false;
    for (let ei = 0; ei < i64Eligible.length; ei++) {
      if (i64Eligible[ei] === stmt.name) {
        isI64 = true;
        break;
      }
    }
    if (isI64 && val.value % 1 === 0 && val.isFloat !== true) {
      return { llvmType: "i64", value: String(Math.trunc(val.value)) };
    }
    const s = String(val.value);
    if (s.indexOf(".") === -1 && s.indexOf("e") === -1 && s.indexOf("E") === -1) {
      return { llvmType: "double", value: s + ".0" };
    }
    return { llvmType: "double", value: s };
  }
  if (val.type === "boolean") {
    return { llvmType: "double", value: val.value === true ? "0x3FF0000000000000" : "0.0" };
  }
  return null;
}

export function handleUninitializedGlobalVar(
  ctx: GlobalVarContext,
  name: string,
  declaredType: string,
): string {
  const baseType = stripNullable(declaredType);
  if (baseType === "string") {
    ctx.globalVarSet(name, {
      llvmType: "i8*",
      kind: SymbolKind_String,
      initialized: false,
    });
    ctx.defineVariable(name, `@${name}`, "i8*", SymbolKind_String, "global");
    return `@${name} = global i8* null\n`;
  }
  if (baseType === "number") {
    ctx.globalVarSet(name, {
      llvmType: "double",
      kind: SymbolKind_Number,
      initialized: false,
    });
    ctx.defineVariable(name, `@${name}`, "double", SymbolKind_Number, "global");
    return `@${name} = global double 0.0\n`;
  }
  if (baseType === "boolean") {
    ctx.globalVarSet(name, {
      llvmType: "double",
      kind: SymbolKind_Boolean,
      initialized: false,
    });
    ctx.defineVariable(name, `@${name}`, "double", SymbolKind_Boolean, "global");
    return `@${name} = global double 0.0\n`;
  }
  if (baseType === "string[]") {
    ctx.globalVarSet(name, {
      llvmType: "%StringArray*",
      kind: SymbolKind_StringArray,
      initialized: false,
    });
    ctx.defineVariable(name, `@${name}`, "%StringArray*", SymbolKind_StringArray, "global");
    return `@${name} = global %StringArray* null\n`;
  }
  if (baseType === "boolean[]") {
    ctx.globalVarSet(name, {
      llvmType: "%Uint8Array*",
      kind: SymbolKind_Uint8Array,
      initialized: false,
    });
    ctx.defineVariable(name, `@${name}`, "%Uint8Array*", SymbolKind_Uint8Array, "global");
    return `@${name} = global %Uint8Array* null\n`;
  }
  if (baseType === "number[]") {
    ctx.globalVarSet(name, {
      llvmType: "%Array*",
      kind: SymbolKind_Array,
      initialized: false,
    });
    ctx.defineVariable(name, `@${name}`, "%Array*", SymbolKind_Array, "global");
    return `@${name} = global %Array* null\n`;
  }
  if (isAnyArrayTsType(baseType)) {
    ctx.globalVarSet(name, {
      llvmType: "%ObjectArray*",
      kind: SymbolKind_ObjectArray,
      initialized: false,
    });
    ctx.defineVariable(name, `@${name}`, "%ObjectArray*", SymbolKind_ObjectArray, "global");
    return `@${name} = global %ObjectArray* null\n`;
  }
  const declaredIr = tryHandleGlobalDeclaredType(ctx, name, declaredType);
  if (declaredIr.length > 0) return declaredIr;
  return "";
}

export function generateGlobalVariableDeclarations(ctx: GlobalVarContext): string {
  let ir = "";
  const totalCount = ctx.topLevelStatementsCount;
  if (totalCount === 0) {
    return ir;
  }
  const items = ctx.ast.topLevelStatements;
  const i64Eligible = findI64EligibleVariables(ctx.ast.topLevelStatements);
  for (let stmtIdx = 0; stmtIdx < totalCount; stmtIdx++) {
    const stmt = items[stmtIdx] as VariableDeclaration;
    if (stmt.type !== "variable_declaration") continue;
    if (stmt.value !== null) {
      const name = stmt.name;

      const stmtValType = (stmt.value as VariableNode).type as string;
      const isUndefinedValue =
        stmtValType === "undefined" ||
        (stmtValType === "variable" && (stmt.value as VariableNode).name === "undefined") ||
        stmtValType === "null";
      if (isUndefinedValue && stmt.declaredType) {
        const globalIr = handleUninitializedGlobalVar(ctx, name, stmt.declaredType);
        if (globalIr.length > 0) {
          ir += globalIr;
          continue;
        }
      }

      if ((stmt.value as { type: string }).type === "call") {
        const callNode = stmt.value as CallNode;
        if (callNode.name) {
          const callIr = tryHandleGlobalCallReturn(ctx, name, callNode);
          if (callIr.length > 0) {
            ir += callIr;
            continue;
          }
        }
      }

      const resolved = ctx.typeOf(stmt.value);
      let resolvedBase = "";
      let resolvedDepth = 0;
      if (resolved) {
        resolvedBase = resolved.base;
        resolvedDepth = resolved.arrayDepth;
      }
      let isString = false;
      let isStringArray = false;
      let isObjectArray = false;
      let isArray = false;
      let isObject = false;
      let isMap = false;
      let isSet = false;
      let isRegex = false;
      let isClassInstance = false;
      let isUint8Array = false;
      let isBoolean = false;
      let isNumber = false;
      if (resolved) {
        const base = resolvedBase;
        const depth = resolvedDepth;
        isString = base === "string" && depth === 0;
        isStringArray = base === "string" && depth > 0;
        isObjectArray = depth > 0 && base !== "string" && base !== "number" && base !== "boolean";
        isArray = depth > 0 && base === "number";
        if (depth > 0 && base === "boolean") isUint8Array = true;
        isMap = base === "Map" || base.startsWith("Map<");
        isSet = base === "Set" || base.startsWith("Set<");
        isRegex = base === "RegExp";
        isObject = base === "object" && depth === 0;
        isBoolean = base === "boolean" && depth === 0;
        isNumber = base === "number" && depth === 0;
        isUint8Array = base === "Uint8Array" && depth === 0;
        isClassInstance =
          !isRegex &&
          depth === 0 &&
          base !== "string" &&
          base !== "number" &&
          base !== "boolean" &&
          base !== "void" &&
          base !== "null" &&
          base !== "unknown" &&
          base !== "object" &&
          base !== "Promise" &&
          base !== "Response" &&
          !base.startsWith("Map") &&
          !base.startsWith("Set") &&
          ctx.isKnownClass(base);
      }
      if (!isStringArray && stmt.declaredType === "string[]") {
        isStringArray = true;
      }
      if (!isObjectArray && stmt.declaredType && isObjectArrayTsType(stmt.declaredType)) {
        isObjectArray = true;
      }
      if (!isObjectArray && stmt.value && ctx.typeInferenceIsObjectArrayExpression(stmt.value)) {
        isObjectArray = true;
      }
      if (!isUint8Array && stmt.declaredType === "Uint8Array") {
        isUint8Array = true;
        isString = false;
      }
      if (!isUint8Array && stmt.value && ctx.typeInferenceIsUint8ArrayExpression(stmt.value)) {
        isUint8Array = true;
        isString = false;
      }
      if (!isUint8Array && stmt.declaredType === "boolean[]") {
        isUint8Array = true;
        isArray = false;
      }
      if (
        !isClassInstance &&
        stmt.value &&
        (stmt.value as { type: string }).type === "index_access"
      ) {
        const idxClassName = ctx.getIndexAccessClassName(stmt.value);
        if (idxClassName) {
          isClassInstance = true;
          resolvedBase = idxClassName;
        }
      }
      if (
        !isClassInstance &&
        stmt.value &&
        (stmt.value as { type: string }).type === "member_access"
      ) {
        const memberClassName = ctx.getMemberAccessClassName(stmt.value);
        if (memberClassName) {
          isClassInstance = true;
          resolvedBase = memberClassName;
        }
      }

      const isJSONParse = ctx.typeInferenceIsJSONParseExpression(stmt.value);

      let llvmType: string = "";
      let kind: number = SymbolKind_Number;
      let defaultValue: string = "0.0";

      const stmtValueBase = stmt.value as { type: string };
      if (stmtValueBase.type === "new") {
        const newNode = stmt.value as NewNode;
        if (newNode.className === "URL") {
          ir += `@${name} = global i8* null` + "\n";
          ctx.globalVarSet(name, {
            llvmType: "i8*",
            kind: SymbolKind_Url,
            initialized: false,
          });
          ctx.symbolTableDefineUrl(name, `@${name}`, "global");
          continue;
        }
        if (newNode.className === "URLSearchParams") {
          ir += `@${name} = global i8* null` + "\n";
          ctx.globalVarSet(name, {
            llvmType: "i8*",
            kind: SymbolKind_UrlSearchParams,
            initialized: false,
          });
          ctx.symbolTableDefineUrlSearchParams(name, `@${name}`, "global");
          continue;
        }
      }

      if (isString) {
        llvmType = "i8*";
        kind = SymbolKind_String;
        defaultValue = "null";
        if (stmtValueBase.type === "method_call") {
          const mc = stmt.value as MethodCallNode;
          if (mc.method === "find" || mc.method === "at") {
            const mcObj = mc.object as { type: string };
            if (mcObj.type === "variable") {
              const arrName = (mc.object as VariableNode).name;
              const elemType =
                ctx.symbolTableGetObjectArrayElementType(arrName) ||
                ctx.symbolTableGetRawInterfaceType(arrName);
              if (elemType) {
                const classFields = ctx.classGenGetClassFields(elemType);
                if (classFields.length > 0) {
                  kind = SymbolKind_Class;
                  ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
                  ctx.globalVarSet(name, { llvmType, kind, initialized: false });
                  ctx.defineVariableWithMetadata(
                    name,
                    `@${name}`,
                    llvmType,
                    kind,
                    "global",
                    createClassMetadata({ className: elemType }),
                  );
                } else {
                  kind = SymbolKind_Object;
                  ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
                  ctx.globalVarSet(name, { llvmType, kind, initialized: false });
                  const props = ctx.getInterfaceProperties(elemType);
                  if (props) {
                    ctx.defineVariableWithMetadata(
                      name,
                      `@${name}`,
                      llvmType,
                      kind,
                      "global",
                      createObjectMetadataWithInterface(
                        { keys: props.keys, types: props.types },
                        elemType,
                      ),
                    );
                  } else {
                    ctx.defineVariable(name, `@${name}`, llvmType, kind, "global");
                  }
                  ctx.symbolTableSetRawInterfaceType(name, elemType);
                }
                continue;
              }
            }
          }
        }
      } else if (isStringArray) {
        llvmType = "%StringArray*";
        kind = SymbolKind_StringArray;
        defaultValue = "null";
      } else if (isObjectArray) {
        let elementType = "";
        if (stmt.declaredType) {
          const declType = stmt.declaredType;
          const typeLen = declType.length;
          if (typeLen > 2) {
            elementType = declType.substr(0, typeLen - 2);
          }
        }
        if (!elementType && resolvedBase && ctx.isKnownClass(resolvedBase)) {
          elementType = resolvedBase;
        }
        if (!elementType && stmt.value) {
          const objArrElemType = ctx.typeInferenceGetObjectArrayElementType(stmt.value);
          if (objArrElemType) elementType = objArrElemType;
        }
        llvmType = "%ObjectArray*";
        kind = SymbolKind_ObjectArray;
        defaultValue = "null";
        ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
        ctx.globalVarSet(name, { llvmType, kind, initialized: false });
        if (elementType) {
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            llvmType,
            kind,
            "global",
            createInterfaceMetadata(elementType),
          );
          ctx.symbolTableSetRawInterfaceType(name, elementType);
        } else {
          ctx.defineVariable(name, `@${name}`, llvmType, kind, "global");
        }
        if (stmt.declaredType) {
          ctx.symbolTableSetResolvedType(name, parseTypeString(stmt.declaredType));
        } else if (resolved) {
          ctx.symbolTableSetResolvedType(name, resolved);
        }
        continue;
      } else if (isUint8Array) {
        llvmType = "%Uint8Array*";
        kind = SymbolKind_Uint8Array;
        defaultValue = "null";
        ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
        ctx.globalVarSet(name, { llvmType, kind, initialized: false });
        ctx.defineVariable(name, `@${name}`, llvmType, kind, "global");
        continue;
      } else if (isArray) {
        llvmType = "%Array*";
        kind = SymbolKind_Array;
        defaultValue = "null";
      } else if (isObject) {
        llvmType = "i8*";
        kind = SymbolKind_Object;
        defaultValue = "null";
        const objMeta = ctx.getObjectMetadata(stmt.value as ObjectNode, stmt.declaredType);
        if (objMeta && objMeta.keys.length > 0) {
          const interfaceName = stmt.declaredType || undefined;
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          ctx.globalVarSet(name, { llvmType, kind, initialized: false });
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            llvmType,
            kind,
            "global",
            createObjectMetadataWithInterface(
              { keys: objMeta.keys, types: objMeta.types },
              interfaceName || "",
            ),
          );
          continue;
        }
      } else if (isMap) {
        let declaredKeyType: string | null = null;
        if (stmt.declaredType) {
          const parsedDecl = parseMapTypeString(stmt.declaredType);
          if (parsedDecl) declaredKeyType = parsedDecl.keyType;
        }
        let isStringMap = false;
        let mapValueType = "string";
        if (stmt.declaredType) {
          const dt = stmt.declaredType;
          if (dt.indexOf("Map<string") !== -1) {
            isStringMap = true;
            const parsed = parseMapTypeString(dt);
            if (parsed) mapValueType = parsed.valueType;
          }
        }
        if (!isStringMap && declaredKeyType === null && stmt.value) {
          const mapNode = stmt.value as MapNode;
          if (mapNode.keyType === "string") {
            isStringMap = true;
            mapValueType = mapNode.valueType || "string";
          }
        }
        if (!isStringMap && declaredKeyType === null && resolvedBase.startsWith("Map<")) {
          const parsed = parseMapTypeString(resolvedBase);
          if (parsed && parsed.keyType === "string") {
            isStringMap = true;
            mapValueType = parsed.valueType;
          }
        }
        if (isStringMap) {
          llvmType = "%StringMap*";
          kind = SymbolKind_Map;
          defaultValue = "null";
          const llvmValueType = mapValueType === "number" ? "double" : "i8*";
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          ctx.globalVarSet(name, { llvmType, kind, initialized: false });
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            llvmType,
            kind,
            "global",
            createMapMetadataSymbol({
              keyType: "string",
              valueType: mapValueType,
              llvmKeyType: "i8*",
              llvmValueType,
            }),
          );
          continue;
        }
        let isPointerMap = false;
        let pointerMapKeyType = "";
        let pointerMapValueType = "string";
        if (stmt.declaredType) {
          const parsed = parseMapTypeString(stmt.declaredType);
          if (parsed && parsed.keyType !== "string" && parsed.keyType !== "number") {
            isPointerMap = true;
            pointerMapKeyType = parsed.keyType;
            pointerMapValueType = parsed.valueType;
          }
        }
        if (!isPointerMap && declaredKeyType === null && resolvedBase.startsWith("Map<")) {
          const parsed = parseMapTypeString(resolvedBase);
          if (parsed && parsed.keyType !== "string" && parsed.keyType !== "number") {
            isPointerMap = true;
            pointerMapKeyType = parsed.keyType;
            pointerMapValueType = parsed.valueType;
          }
        }
        if (isPointerMap) {
          llvmType = "%StringMap*";
          kind = SymbolKind_Map;
          defaultValue = "null";
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          ctx.globalVarSet(name, { llvmType, kind, initialized: false });
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            llvmType,
            kind,
            "global",
            createMapMetadataSymbol({
              keyType: pointerMapKeyType,
              valueType: pointerMapValueType,
              llvmKeyType: "i8*",
              llvmValueType: "i8*",
            }),
          );
          continue;
        }
        llvmType = "%Map*";
        kind = SymbolKind_Map;
        defaultValue = "null";
      } else if (isSet) {
        let isStringSet = false;
        if (stmt.declaredType) {
          if (stmt.declaredType.indexOf("Set<string") !== -1) {
            isStringSet = true;
          }
        }
        if (!isStringSet && stmt.value) {
          const resolved = ctx.typeOf(stmt.value);
          if (resolved && resolved.base === "Set<string>") {
            isStringSet = true;
          }
        }
        if (isStringSet) {
          llvmType = "%StringSet*";
          kind = SymbolKind_Set;
          defaultValue = "null";
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          ctx.globalVarSet(name, { llvmType, kind, initialized: false });
          ctx.defineVariableWithMetadata(
            name,
            `@${name}`,
            llvmType,
            kind,
            "global",
            createSetMetadataSymbol({
              valueType: "string",
              llvmValueType: "i8*",
            }),
          );
          continue;
        }
        llvmType = "%Set*";
        kind = SymbolKind_Set;
        defaultValue = "null";
      } else if (isRegex) {
        llvmType = "i8*";
        kind = SymbolKind_Regex;
        defaultValue = "null";
      } else if (isClassInstance) {
        let className = "";
        const stmtValueType = (stmt.value as { type: string }).type;
        if (stmtValueType === "new") {
          className = ctx.resolveImportAlias((stmt.value as NewNode).className);
        } else if (stmtValueType === "call") {
          const callExpr = stmt.value as CallNode;
          const func = callExpr.name
            ? ctx.ast.functions.find((f) => f && f.name === callExpr.name && f.returnType)
            : null;
          className = func ? ctx.resolveImportAlias(stripNullable(func.returnType!)) : resolvedBase;
        } else {
          className = resolvedBase;
        }
        const fields = ctx.classGenGetClassFields(className);
        llvmType = fields.length > 0 ? `%${className}_struct*` : "i32*";
        kind = SymbolKind_Class;
        defaultValue = "null";
        ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
        ctx.globalVarSet(name, { llvmType, kind, initialized: false });
        ctx.defineVariableWithMetadata(
          name,
          `@${name}`,
          llvmType,
          kind,
          "global",
          createClassMetadata({ className }),
        );
        continue;
      } else if (isBoolean) {
        llvmType = "double";
        kind = SymbolKind_Boolean;
        defaultValue = "0.0";
      } else if (isNumber) {
        llvmType = "double";
        kind = SymbolKind_Number;
        defaultValue = "0.0";
      } else if (isJSONParse) {
        const jsonIr = tryHandleGlobalJSONParse(ctx, name, stmt.value as MethodCallNode);
        if (jsonIr.length > 0) {
          ir += jsonIr;
          continue;
        }
        llvmType = "i8*";
        kind = SymbolKind_JSON;
        defaultValue = "null";
      } else {
        const declaredIr = tryHandleGlobalDeclaredType(ctx, name, stmt.declaredType);
        if (declaredIr.length > 0) {
          ir += declaredIr;
          continue;
        }
        if (stmt.declaredType) {
          const strippedDeclaredType = stripNullable(stmt.declaredType);
          if (strippedDeclaredType === "string") {
            llvmType = "i8*";
            kind = SymbolKind_String;
            defaultValue = "null";
          } else if (strippedDeclaredType === "number") {
            llvmType = "double";
            kind = SymbolKind_Number;
            defaultValue = "0.0";
          } else if (strippedDeclaredType === "boolean") {
            llvmType = "double";
            kind = SymbolKind_Boolean;
            defaultValue = "0.0";
          } else {
            const akDecl = classifyArray(strippedDeclaredType);
            switch (akDecl) {
              case ArrayKind_None:
                break;
              case ArrayKind_String:
                isStringArray = true;
                break;
              case ArrayKind_Boolean:
                isUint8Array = true;
                isArray = false;
                break;
              case ArrayKind_Number:
                isArray = true;
                break;
              case ArrayKind_Object:
                isObjectArray = true;
                break;
              default:
                throw new Error(`unknown ArrayKind ${akDecl}`);
            }
          }
        }

        if (llvmType === "") {
          const exprIr = tryHandleGlobalExpressionType(ctx, name, stmt.value);
          if (exprIr.length > 0) {
            ir += exprIr;
            continue;
          }
        }

        if (llvmType === "") {
          const catchAllResult = classifyGlobalCatchAll(
            ctx,
            name,
            stmt.value,
            stmt.declaredType,
            i64Eligible,
          );
          if (catchAllResult === null) {
            return ctx.emitError(
              `cannot determine type of module-scope variable '${name}' (expression type: ${stmt.value ? (stmt.value as { type: string }).type : "unknown"}). ` +
                `Move the declaration inside a function, or add a type annotation`,
            );
          }
          llvmType = catchAllResult.llvmType;
          kind = catchAllResult.kind;
          defaultValue = catchAllResult.defaultValue;
        }
      }

      const constLiteral = tryGetConstLiteralValue(stmt, llvmType, i64Eligible);
      if (constLiteral !== null) {
        ir += `@${name} = constant ${constLiteral.llvmType} ${constLiteral.value}` + "\n";
        ctx.globalVarSet(name, {
          llvmType: constLiteral.llvmType,
          kind,
          initialized: false,
        });
        ctx.defineVariable(name, `@${name}`, constLiteral.llvmType, kind, "global");
        ctx.symbolTableMarkLLVMConstant(name);
      } else {
        ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
        ctx.globalVarSet(name, { llvmType, kind, initialized: false });
        ctx.defineVariable(name, `@${name}`, llvmType, kind, "global");
      }
      if (stmt.declaredType) {
        ctx.symbolTableSetResolvedType(name, parseTypeString(stmt.declaredType));
      } else if (stmt.value) {
        const resolved = ctx.typeOf(stmt.value);
        if (resolved) {
          ctx.symbolTableSetResolvedType(name, resolved);
        }
      }
    } else if (stmt.declaredType) {
      const name = stmt.name;
      const globalIr = handleUninitializedGlobalVar(ctx, name, stmt.declaredType);
      if (globalIr.length > 0) {
        ir += globalIr;
      }
    }
  }
  if (ir.length > 0) {
    ir += "\n";
  }
  return ir;
}
