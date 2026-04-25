import {
  Expression,
  NewNode,
  MethodCallNode,
  MemberAccessNode,
  VariableNode,
  ObjectNode,
  AST,
  InterfaceDeclaration,
  InterfaceField,
  EnumDeclaration,
  EnumMember,
  ClassNode,
  IndexAccessNode,
  TypeAssertionNode,
  FunctionParameter,
  CallNode,
  FunctionNode,
  ClassField,
  SourceLocation,
} from "../../../ast/types.js";
import type { SymbolTable } from "../../infrastructure/symbol-table.js";
import type { TypeChecker } from "../../../typescript/type-checker.js";
import type {
  InterfaceStructGenerator,
  InterfaceFieldInfo,
  InterfaceStructInfo,
} from "../../types/interface-struct-generator.js";
import {
  stripOptional,
  stripNullable,
  tsTypeToLlvm,
  parseMapTypeString,
  canonicalTypeToLlvm,
  isObjectArrayTsType,
} from "../../infrastructure/type-system.js";
import type { ResolvedType } from "../../infrastructure/type-system.js";
import type {
  IStringGenerator,
  IMapGenerator,
  IStringMapGenerator,
  IPointerMapGenerator,
  ISetGenerator,
  IStringSetGenerator,
  IResponseGenerator,
} from "../../infrastructure/generator-context.js";
import {
  isProcessArgv,
  isProcessPlatform,
  isProcessEnvAccess,
  handleProcessEnvAccess,
  handleProcessSimpleProperty,
  handleProcessArgv,
  handleProcessPlatform,
} from "./process-access.js";
import { handleOsProperty } from "./os-access.js";
import {
  handleLengthProperty,
  handleMemberAccessLength,
  handleSizeProperty,
  handleResponseProperty,
  handleStatProperty,
  handlePathParseProperty,
  isProcessArgvLength,
  getArrayLength,
  getStringArrayLength,
  getStringArrayLengthFromPtr,
  getArrayLengthFromPtr,
  getStringLength,
  handleSpawnSyncResultProperty,
  handleUrlProperty,
} from "./property-handlers.js";
import {
  parseInlineObjectTypeForAssertion,
  splitByTopLevelSemicolon,
  findTopLevelColon,
} from "./type-assertion-access.js";
import {
  handleJsonPropertyAccess,
  handleNestedJsonAccess,
  handleNestedInterfaceField,
  extractJsonFieldValue,
  extractNestedJsonFieldValue,
} from "./chained-access.js";
import { accessObjectWithMetadata, accessObjectProperty } from "./struct-access.js";
import { createStringConstant } from "../../types/collections/string/constants.js";

interface ExprBase {
  type: string;
}

import type { FieldInfo } from "../../infrastructure/type-resolver/types.js";

interface MapGeneratorLike {
  generateMapSize(mapPtr: string): string;
}

interface SetGeneratorLike {
  generateSetSize(setPtr: string): string;
}

interface ResponseGeneratorLike {
  generateStatus(responsePtr: string): string;
  generateOk(responsePtr: string): string;
}

interface ObjectMetadata {
  keys: string[];
  types: string[];
  tsTypes?: string[];
}

export interface JsonObjectMeta {
  keys: string[];
  types: string[];
  tsTypes?: string[];
  interfaceType?: string;
}

interface InterfaceProperty {
  name: string;
  type: string;
}

interface InterfaceInfo {
  properties: InterfaceProperty[];
}

export interface MemberAccessGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  getCurrentLabel(): string;
  setCurrentLabel(label: string): void;
  emit(instruction: string): void;
  emitStore(type: string, value: string, ptr: string): void;
  emitLoad(type: string, ptr: string): string;
  emitCall(retType: string, func: string, args: string): string;
  emitCallVoid(func: string, args: string): void;
  emitBitcast(value: string, fromType: string, toType: string): string;
  emitIcmp(pred: string, type: string, lhs: string, rhs: string): string;
  emitBr(label: string): void;
  emitBrCond(cond: string, thenLabel: string, elseLabel: string): void;
  emitLabel(name: string): void;
  emitGep(baseType: string, ptr: string, indices: string): string;
  readonly symbolTable: SymbolTable;
  getAst(): AST | undefined;
  getThisPointer(): string | null;
  getCurrentClassName(): string | null;
  getCurrentFunction(): string | null;
  setJsonObjectMetadata(key: string, value: JsonObjectMeta): void;
  getJsonObjectMetadata(key: string): JsonObjectMeta | undefined;
  hasJsonObjectMetadata(key: string): boolean;
  getJsonObjectMetadataKeys(key: string): string[] | undefined;
  getJsonObjectMetadataTypes(key: string): string[] | undefined;
  getJsonObjectMetadataTsTypes(key: string): string[] | undefined;
  getJsonObjectMetadataInterfaceType(key: string): string | undefined;
  getParameterTypeFromAST(paramName: string): string | null;
  findClassImplementingInterface(interfaceName: string): string | null;
  getInterfaceProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  getInterfaceDeclByName(name: string): InterfaceDeclaration | null;
  findInterfaceForFields(fieldNames: string[]): string | null;
  getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[];
  isTypeAlias(name: string): boolean;
  getTypeAliasCommonProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null;
  getInterfaceFieldType(interfaceName: string, fieldName: string): string | null;
  getMethodReturnType(className: string, methodName: string): string | null;
  resolveImportAlias(localName: string): string;
  isEnumType(name: string): boolean;
  getEnumMemberValue(enumName: string, memberName: string): number;
  getEnumMemberStringValue(enumName: string, memberName: string): string | null;
  nextString(): string;
  pushGlobalString(decl: string): void;
  getClassesCount(): number;
  getAstClassAt(index: number): ClassNode | null;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  getVariableAlloca(name: string): string | undefined;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  emitWarning(message: string, loc?: SourceLocation, suggestion?: string): void;
  getObjectMetadata(obj: ObjectNode, targetInterface?: string): ObjectMetadata;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  classGenGetFieldType(className: string, fieldName: string): string | null;
  classGenGetFieldTsType(className: string, fieldName: string): string | null;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  readonly responseGen: IResponseGenerator;
  readonly mapGen: IMapGenerator;
  readonly stringMapGen: IStringMapGenerator;
  readonly pointerMapGen: IPointerMapGenerator;
  readonly setGen: ISetGenerator;
  readonly stringSetGen: IStringSetGenerator;
  readonly interfaceStructGen?: InterfaceStructGenerator;
  generateExpression(expr: Expression, params: string[]): string;
  readonly stringGen: IStringGenerator;
  interfaceStructGenHasInterface(name: string): boolean;
  interfaceStructGenGetInterfaceStruct(name: string): InterfaceStructInfo | undefined;
  setActualClassType(name: string, className: string): void;
  getActualClassType(name: string): string | undefined;
  setUsesJson(value: boolean): void;
  getTargetOS(): string;
  getTargetArch(): string;
  classGenIsStaticField(className: string, fieldName: string): boolean;
  classGenGetStaticFieldType(className: string, fieldName: string): string;
  mangleUserName(name: string): string;
  typeOf(expr: Expression): ResolvedType | null;
}

export type MemberAccessHandlerFn = (
  expr: MemberAccessNode,
  ctx: MemberAccessGeneratorContext,
  params: string[],
) => string | null;

/**
 * MemberAccessGenerator
 *
 * Handles property access expressions via a priority-ordered dispatch chain.
 * Each handler returns string | null (null = didn't handle, try next).
 *
 * Handler order (priority):
 *  1. Enum member access
 *  2. Typed JSON struct access
 *  3. process.argv / process.platform / process.env / process.simple
 *  4. Class property access
 *  5. JSON property access (variable flagged as JSON)
 *  6. Chained access (member_access: interface, class field, nested JSON)
 *  7. Index access (arr[i].property)
 *  8. Type assertion access ((expr as Type).property)
 *  9. Method call result access (map.get(key).property)
 * 10. Object property access
 * 11. .length property
 * 12. .size property (Map/Set)
 * 13. Response properties
 * 14. Stat properties
 * 15. Parameter property access (fallback)
 */
export class MemberAccessGenerator {
  constructor(private ctx: MemberAccessGeneratorContext) {}

  private dispatchHandlers(expr: MemberAccessNode, params: string[]): string | null {
    let result: string | null;

    result = this.dispatchSpecialValues(expr, params);
    if (result !== null) return result;

    result = this.handleClassPropertyAccess(expr, params);
    if (result !== null) return result;

    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase ? exprObjBase.type : null;
    if (exprObjType === null || exprObjType === undefined) {
      return this.ctx.emitError(
        `cannot access property '${expr.property}' — object expression has no type`,
        expr.loc,
      );
    }

    result = this.dispatchByExpressionType(expr, params, exprObjType);
    if (result !== null) return result;

    return this.dispatchPropertyHandlers(expr, params);
  }

  private dispatchSpecialValues(expr: MemberAccessNode, params: string[]): string | null {
    const enumResult = this.dispatchEnumAndStaticAccess(expr);
    if (enumResult !== null) return enumResult;

    return this.dispatchBuiltinPropertyAccess(expr);
  }

  private dispatchEnumAndStaticAccess(expr: MemberAccessNode): string | null {
    let result: string | null;

    result = this.handleStringEnumMemberAccess(expr);
    if (result !== null) return result;

    result = this.handleEnumMemberAccess(expr);
    if (result !== null) return result;

    result = this.handleStaticFieldAccess(expr);
    if (result !== null) return result;

    return this.handleTypedJsonStructAccess(expr);
  }

  private dispatchBuiltinPropertyAccess(expr: MemberAccessNode): string | null {
    if (isProcessArgv(expr)) return this.handleProcessArgv();

    if (isProcessPlatform(expr)) return handleProcessPlatform(this.ctx);

    if (isProcessEnvAccess(expr)) return this.handleProcessEnvAccess(expr);

    let result: string | null;
    result = handleProcessSimpleProperty(this.ctx, expr);
    if (result !== null) return result;

    result = handleOsProperty(this.ctx, expr);
    if (result !== null) return result;

    if (
      expr.object.type === "variable" &&
      (expr.object as VariableNode).name === "path" &&
      expr.property === "sep"
    ) {
      return this.ctx.stringGen.doCreateStringConstant("/");
    }

    if (
      expr.object.type === "variable" &&
      (expr.object as VariableNode).name === "path" &&
      expr.property === "delimiter"
    ) {
      return this.ctx.stringGen.doCreateStringConstant(":");
    }

    return null;
  }

  private dispatchByExpressionType(
    expr: MemberAccessNode,
    params: string[],
    exprObjType: string,
  ): string | null {
    const structured = this.dispatchStructuredAccess(expr, params, exprObjType);
    if (structured !== null) return structured;

    return this.dispatchCallAndObjectAccess(expr, params, exprObjType);
  }

  private dispatchStructuredAccess(
    expr: MemberAccessNode,
    params: string[],
    exprObjType: string,
  ): string | null {
    let result: string | null;

    if (
      exprObjType === "variable" &&
      this.ctx.symbolTable.isJSON((expr.object as VariableNode).name)
    ) {
      return this.handleJsonPropertyAccess(expr, params);
    }

    if (exprObjType === "member_access") {
      result = this.handleChainedInterfaceAccess(expr, params);
      if (result !== null) return result;
      result = this.handleClassFieldChainedAccess(expr, params);
      if (result !== null) return result;
      result = this.handleNestedJsonAccess(expr, params);
      if (result !== null) return result;
    }

    if (exprObjType === "index_access") {
      result = this.handleIndexAccessPropertyAccess(expr, params);
      if (result !== null) return result;
    }

    if (exprObjType === "type_assertion") {
      result = this.handleTypeAssertionPropertyAccess(expr, params);
      if (result !== null) return result;
    }

    return null;
  }

  private dispatchCallAndObjectAccess(
    expr: MemberAccessNode,
    params: string[],
    exprObjType: string,
  ): string | null {
    let result: string | null;

    if (exprObjType === "method_call") {
      result = this.handleMethodCallResultPropertyAccess(expr, params);
      if (result !== null) return result;
    }

    if (exprObjType === "call") {
      result = this.handleCallResultPropertyAccess(expr, params);
      if (result !== null) return result;
    }

    result = this.handleObjectPropertyAccess(expr, params);
    if (result !== null) return result;

    return null;
  }

  private dispatchPropertyHandlers(expr: MemberAccessNode, params: string[]): string | null {
    if (expr.property === "length") return this.handleLengthProperty(expr, params);

    const common = this.dispatchCommonPropertyHandlers(expr, params);
    if (common !== null) return common;

    return this.dispatchExtendedPropertyHandlers(expr);
  }

  private dispatchCommonPropertyHandlers(expr: MemberAccessNode, params: string[]): string | null {
    let result: string | null;

    result = this.handleSizeProperty(expr, params);
    if (result !== null) return result;

    result = this.handleResponseProperty(expr);
    if (result !== null) return result;

    result = this.handleStatProperty(expr);
    if (result !== null) return result;

    return this.handlePathParseProperty(expr);
  }

  private dispatchExtendedPropertyHandlers(expr: MemberAccessNode): string | null {
    let result: string | null;

    result = this.handleSpawnSyncResultProperty(expr);
    if (result !== null) return result;

    return this.handleUrlProperty(expr);
  }

  private hasObjectInfo(name: string): boolean {
    if (!this.ctx.symbolTable.isObject(name) && !this.ctx.symbolTable.isJSON(name)) return false;
    return this.ctx.symbolTable.getObjectMetadataKeys(name) !== undefined;
  }

  private findClassImplementingInterface(interfaceName: string): string | null {
    return this.ctx.findClassImplementingInterface(interfaceName);
  }

  private resolveConcreteClass(varName: string, interfaceName: string): string | null {
    const concrete = this.ctx.symbolTable.getConcreteClass(varName);
    if (concrete) return concrete;
    return this.ctx.findClassImplementingInterface(interfaceName);
  }

  private resolveConcreteClassForRegister(register: string, interfaceName: string): string | null {
    const concrete = this.ctx.getActualClassType(register);
    if (concrete) return concrete;
    return this.ctx.findClassImplementingInterface(interfaceName);
  }

  private resolveConcreteClassByFields(
    interfaceKeys: string[],
    targetProperty: string,
  ): string | null {
    const classCount = this.ctx.getClassesCount();
    let bestMatch: string | null = null;
    let bestMatchCount = 0;
    for (let i = 0; i < classCount; i++) {
      const cls = this.ctx.getAstClassAt(i);
      if (!cls || !cls.name || !cls.fields) continue;
      const fieldInfo = this.ctx.classGenGetFieldInfo(cls.name, targetProperty);
      if (!fieldInfo) continue;
      let matchCount = 0;
      for (let k = 0; k < interfaceKeys.length; k++) {
        const key = interfaceKeys[k];
        if (this.ctx.classGenGetFieldInfo(cls.name, key)) {
          matchCount++;
        }
      }
      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestMatch = cls.name;
      }
    }
    if (bestMatch && bestMatchCount >= 3) {
      return bestMatch;
    }
    return null;
  }

  private findClassStructurallyMatchingInterface(interfaceName: string): string | null {
    const props = this.ctx.getInterfaceProperties(interfaceName);
    if (!props || props.keys.length === 0) return null;
    const classCount = this.ctx.getClassesCount();
    let bestMatch: string | null = null;
    let bestCount = 0;
    for (let i = 0; i < classCount; i++) {
      const cls = this.ctx.getAstClassAt(i);
      if (!cls || !cls.name) continue;
      if (cls.name.indexOf("Mock") !== -1 || cls.name.indexOf("Test") !== -1) continue;
      let matchCount = 0;
      for (let k = 0; k < props.keys.length; k++) {
        if (this.ctx.classGenGetFieldInfo(cls.name, props.keys[k])) {
          matchCount++;
        }
      }
      if (matchCount > bestCount) {
        bestCount = matchCount;
        bestMatch = cls.name;
      }
    }
    if (bestMatch && bestCount >= 3) return bestMatch;
    return null;
  }

  private getInterfaceFromAST(name: string): InterfaceInfo | null {
    const baseName = this.extractBaseTypeName(name);
    const props = this.ctx.getInterfaceProperties(baseName);
    if (props && props.keys.length > 0) {
      const properties: InterfaceProperty[] = [];
      for (let i = 0; i < props.keys.length; i++) {
        // InterfaceProperty.type needs TS types for type matching, not LLVM types
        properties.push({ name: props.keys[i], type: props.tsTypes[i] });
      }
      return { properties };
    }
    const typeAliasResult = this.getTypeAliasCommonProperties(baseName);
    if (typeAliasResult) return typeAliasResult;
    return null;
  }

  private getInterfaceDecl(name: string): InterfaceDeclaration | null {
    return this.ctx.getInterfaceDeclByName(name);
  }

  private extractBaseTypeName(typeStr: string): string {
    const parts = typeStr.split("|");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part !== "null" && part !== "undefined") {
        return part;
      }
    }
    return typeStr;
  }

  private isTypeAlias(name: string): boolean {
    return this.ctx.isTypeAlias(name);
  }

  private getTypeAliasCommonProperties(name: string): { properties: InterfaceProperty[] } | null {
    const props = this.ctx.getTypeAliasCommonProperties(name);
    if (!props || props.keys.length === 0) return null;
    const properties: InterfaceProperty[] = [];
    for (let i = 0; i < props.keys.length; i++) {
      // InterfaceProperty.type needs TS types for type matching, not LLVM types
      properties.push({ name: props.keys[i], type: props.tsTypes[i] });
    }
    return { properties };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (type1 === type2) return true;
    const isStringLiteral1 = type1.startsWith("'") && type1.endsWith("'");
    const isStringLiteral2 = type2.startsWith("'") && type2.endsWith("'");
    if (isStringLiteral1 && isStringLiteral2) return true;
    if ((isStringLiteral1 && type2 === "string") || (isStringLiteral2 && type1 === "string"))
      return true;
    return false;
  }

  private unifyTypes(type1: string, type2: string): string {
    const isStringLiteral1 = type1.startsWith("'") && type1.endsWith("'");
    const isStringLiteral2 = type2.startsWith("'") && type2.endsWith("'");
    if (isStringLiteral1 || isStringLiteral2) return "string";
    return type1;
  }

  generate(expr: MemberAccessNode, params: string[]): string {
    if (expr.optional) {
      return this.generateOptionalChain(expr, params);
    }

    if (!expr.property || expr.property === "") {
      return this.ctx.generateExpression(expr.object, params);
    }

    const result = this.dispatchHandlers(expr, params);
    if (result !== null) return result;

    return this.handleParameterPropertyAccess(expr, params);
  }

  private generateOptionalChain(expr: MemberAccessNode, params: string[]): string {
    const objValue = this.ctx.generateExpression(expr.object, params);
    const objType = this.ctx.getVariableType(objValue) || "double";

    if (objType === "double" || objType === "i32" || objType === "i64" || objType === "i1") {
      const nonOptExpr: MemberAccessNode = {
        type: "member_access",
        object: expr.object,
        property: expr.property,
        loc: expr.loc,
      };
      return this.generate(nonOptExpr, params);
    }

    const isValidLlvmType =
      !objType.startsWith("%{") && !objType.includes("|") && !objType.includes(":");
    const checkType = isValidLlvmType ? objType : "i8*";
    const isNull = this.ctx.emitIcmp("eq", checkType, objValue, "null");

    const accessLabel = this.ctx.nextLabel("opt_access");
    const nullLabel = this.ctx.nextLabel("opt_null");
    const endLabel = this.ctx.nextLabel("opt_end");

    this.ctx.emitBrCond(isNull, nullLabel, accessLabel);

    this.ctx.emitLabel(accessLabel);
    this.ctx.setCurrentLabel(accessLabel);
    const nonOptExpr: MemberAccessNode = {
      type: "member_access",
      object: expr.object,
      property: expr.property,
      loc: expr.loc,
    };
    const accessResult = this.generate(nonOptExpr, params);
    const accessType = this.ctx.getVariableType(accessResult) || "double";
    const accessEndLabel = this.ctx.getCurrentLabel();
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(nullLabel);
    this.ctx.setCurrentLabel(nullLabel);
    let nullValue: string;
    if (accessType === "double") {
      // Quiet NaN sentinel for undefined — `??` in convertToNonNullish treats
      // NaN as nullish via fcmp ord. Legitimate arithmetic NaN also surfaces
      // as undefined (acceptable tradeoff; see optional-chain-undefined-sentinel.md).
      nullValue = "0x7FF8000000000000";
    } else if (accessType === "i1") {
      nullValue = "false";
    } else if (accessType === "i32") {
      nullValue = "0";
    } else {
      nullValue = "null";
    }
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    this.ctx.setCurrentLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi ${accessType} [ ${accessResult}, %${accessEndLabel} ], [ ${nullValue}, %${nullLabel} ]`,
    );
    this.ctx.setVariableType(result, accessType);
    return result;
  }

  private isProcessArgv(expr: MemberAccessNode): boolean {
    return isProcessArgv(expr);
  }

  private isProcessPlatform(expr: MemberAccessNode): boolean {
    return isProcessPlatform(expr);
  }

  private isProcessEnvAccess(expr: MemberAccessNode): boolean {
    return isProcessEnvAccess(expr);
  }

  private handleProcessEnvAccess(expr: MemberAccessNode): string {
    return handleProcessEnvAccess(this.ctx, expr);
  }

  private handleProcessSimpleProperty(expr: MemberAccessNode): string | null {
    return handleProcessSimpleProperty(this.ctx, expr);
  }

  // Separate method for string enums to avoid adding locals to handleEnumMemberAccess,
  // which causes the native compiler to produce invalid LLVM IR.
  private handleStringEnumMemberAccess(expr: MemberAccessNode): string | null {
    if (!expr.object) return null;
    const exprObjBase = expr.object as ExprBase;
    if (!exprObjBase || exprObjBase.type !== "variable") return null;
    const enumName = (expr.object as VariableNode).name;
    const strVal = this.ctx.getEnumMemberStringValue(enumName, expr.property);
    if (strVal === null) return null;
    const result = createStringConstant(this.ctx as any, strVal);
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  private handleEnumMemberAccess(expr: MemberAccessNode): string | null {
    if (!expr.object) {
      return null;
    }
    const exprObjBase = expr.object as ExprBase;
    if (!exprObjBase) {
      return null;
    }
    const exprObjType = exprObjBase.type;
    if (exprObjType !== "variable") return null;

    const exprObjVar = expr.object as VariableNode;
    const enumName = exprObjVar.name;
    const memberName = expr.property;
    const value = this.ctx.getEnumMemberValue(enumName, memberName);
    if (value === -1) {
      return null;
    }
    const result = this.ctx.nextTemp();
    const valueStr = String(value);
    const formattedValue = valueStr.indexOf(".") === -1 ? valueStr + ".0" : valueStr;
    this.ctx.emit(`${result} = fadd nsz arcp contract reassoc afn double ${formattedValue}, 0.0`);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  // Static field access: ClassName.staticField → load from global @_cs_ClassName_fieldName
  private handleStaticFieldAccess(expr: MemberAccessNode): string | null {
    if (!expr.object) return null;
    const exprObjBase = expr.object as ExprBase;
    if (!exprObjBase || exprObjBase.type !== "variable") return null;

    const className = (expr.object as VariableNode).name;
    const fieldName = expr.property;
    if (!this.ctx.classGenIsStaticField(className, fieldName)) return null;

    const llvmType = this.ctx.classGenGetStaticFieldType(className, fieldName);
    const globalName = `@${this.ctx.mangleUserName(className)}_${fieldName}`;
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = load ${llvmType}, ${llvmType}* ${globalName}`);
    this.ctx.setVariableType(result, llvmType);
    return result;
  }

  private handleTypedJsonStructAccess(expr: MemberAccessNode): string | null {
    if (!expr.object) {
      return null;
    }
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase ? exprObjBase.type : null;
    if (exprObjType !== "variable") return null;

    const varName = (expr.object as VariableNode).name;
    const varType = this.ctx.getVariableType(varName);
    if (!varType) {
      return null;
    }
    const startsWithPercent = varType.charAt(0) === "%";
    const endsWithStar = varType.charAt(varType.length - 1) === "*";
    if (!startsWithPercent || !endsWithStar) {
      return null;
    }
    if (
      varType === "%__FetchResponse*" ||
      varType.indexOf("Array") !== -1 ||
      varType.indexOf("Map") !== -1 ||
      varType.indexOf("Set") !== -1
    ) {
      return null;
    }

    const structTypeName = varType.substring(1, varType.length - 1);

    const interfaceDefResult = this.getInterfaceFromAST(structTypeName);
    if (!interfaceDefResult) return null;
    const interfaceDef = interfaceDefResult as InterfaceInfo;
    if (!interfaceDef.properties) return null;

    let propIndex: number = -1;
    for (let i = 0; i < interfaceDef.properties.length; i++) {
      const p = interfaceDef.properties[i] as InterfaceProperty;
      if (p.name === expr.property) {
        propIndex = i;
        break;
      }
    }
    if (propIndex === -1) {
      return this.ctx.emitError(
        `Property '${expr.property}' not found in interface ${structTypeName}`,
        expr.loc,
      );
    }

    const propField = interfaceDef.properties[propIndex] as InterfaceProperty;
    let propType = propField.type;
    const propName = propField.name;
    const varPtr = this.ctx.getVariableAlloca(varName);
    const structPtr = this.ctx.nextTemp();
    this.ctx.emit(`${structPtr} = load %${structTypeName}*, %${structTypeName}** ${varPtr}`);

    const concreteClass =
      this.ctx.getActualClassType(varName) ||
      this.ctx.symbolTable.getConcreteClass(varName) ||
      this.resolveConcreteClassForRegister(structPtr, structTypeName);
    if (concreteClass) {
      const classFieldInfo = this.ctx.classGenGetFieldInfo(concreteClass, expr.property);
      if (classFieldInfo) {
        const castPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${castPtr} = bitcast %${structTypeName}* ${structPtr} to %${concreteClass}_struct*`,
        );
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${concreteClass}_struct, %${concreteClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`,
        );
        this.ctx.setActualClassType(structPtr, concreteClass);
        return this.loadFieldValue(fieldPtr, classFieldInfo, concreteClass, expr.property);
      }
    }

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds %${structTypeName}, %${structTypeName}* ${structPtr}, i32 0, i32 ${propIndex}`,
    );

    if (propName === "nodePtr" || propName === "treePtr") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, "i8*");
      return value;
    } else if (propType === "string") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, "i8*");
      return value;
    } else if (propType === "number") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, "double");
      return value;
    } else if (propType === "boolean") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, "double");
      return value;
    } else if (propType === "string[]") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%StringArray*");
      return value;
    } else {
      let nestedTypeName = propType;
      if (nestedTypeName.endsWith("?")) {
        nestedTypeName = nestedTypeName.slice(0, nestedTypeName.length - 1);
      }
      if (nestedTypeName.indexOf(" | ") !== -1) {
        nestedTypeName = nestedTypeName.split(" | ")[0].trim();
      }
      const isTypeAlias = this.isTypeAlias(nestedTypeName);
      const nestedInterfaceResult = this.getInterfaceFromAST(nestedTypeName);
      if (nestedInterfaceResult) {
        const nestedInterface = nestedInterfaceResult as InterfaceInfo;
        const value = this.ctx.nextTemp();
        if (isTypeAlias) {
          this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
          this.ctx.setVariableType(value, "i8*");
          const keys: string[] = [];
          const types: string[] = [];
          const tsTypes: string[] = [];
          const nestedProps = nestedInterface.properties as InterfaceProperty[];
          for (let pi = 0; pi < nestedProps.length; pi++) {
            const p = nestedProps[pi] as { name: string; type: string };
            keys.push(stripOptional(p.name));
            types.push(tsTypeToLlvm(p.type));
            tsTypes.push(p.type);
          }
          this.ctx.setJsonObjectMetadata(value, { keys, types, tsTypes, interfaceType: undefined });
        } else {
          this.ctx.emit(`${value} = load %${nestedTypeName}*, %${nestedTypeName}** ${fieldPtr}`);
          this.ctx.setVariableType(value, `%${nestedTypeName}*`);
        }
        return value;
      }
    }
    return null;
  }

  private handleProcessArgv(): string {
    return handleProcessArgv(this.ctx);
  }

  private handleClassPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    let className: string | null = null;
    let instancePtr: string | null = null;

    if (!expr.object) {
      return null;
    }
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase ? exprObjBase.type : null;
    if (exprObjType === null || exprObjType === undefined) {
      return null;
    }
    if (exprObjType === "variable") {
      const varName = (expr.object as VariableNode).name;
      const isClass = this.ctx.symbolTable.isClass(varName);
      if (isClass) {
        const classMeta = this.ctx.symbolTable.getClassInfo((expr.object as VariableNode).name);
        if (classMeta) {
          className = classMeta.className;
          instancePtr = this.ctx.generateExpression(expr.object, params);
        }
      } else {
        const concreteClass = this.ctx.symbolTable.getConcreteClass(varName);
        if (concreteClass) {
          const fieldCheck = this.ctx.classGenGetFieldInfo(concreteClass, expr.property);
          if (fieldCheck) {
            className = concreteClass;
            const rawPtr = this.ctx.generateExpression(expr.object, params);
            const ptrType = this.ctx.getVariableType(rawPtr);
            if (ptrType === "i8*" || (ptrType && ptrType !== `%${concreteClass}_struct*`)) {
              const castPtr = this.ctx.nextTemp();
              this.ctx.emit(
                `${castPtr} = bitcast ${ptrType || "i8*"} ${rawPtr} to %${concreteClass}_struct*`,
              );
              this.ctx.setVariableType(castPtr, `%${concreteClass}_struct*`);
              instancePtr = castPtr;
            } else {
              instancePtr = rawPtr;
            }
          }
        }
      }
    } else if (exprObjType === "new") {
      const newExpr = expr.object as NewNode;
      className = newExpr.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if (exprObjType === "this") {
      const thisPtr = this.ctx.getThisPointer();
      if (!thisPtr) {
        return this.ctx.emitError(
          "this.field accessed outside of class method or constructor",
          expr.loc,
        );
      }
      instancePtr = thisPtr;
      className = this.ctx.getCurrentClassName() || null;
      if (!className) {
        const fieldName = expr.property;
        const classCount = this.ctx.getClassesCount();
        for (let ci = 0; ci < classCount; ci++) {
          const c = this.ctx.getAstClassAt(ci);
          if (!c || !c.fields) continue;
          let hasField = false;
          for (let fi = 0; fi < c.fields.length; fi++) {
            const f = c.fields[fi] as ClassField;
            if (f.name === fieldName) {
              hasField = true;
              break;
            }
          }
          if (hasField) {
            className = c.name;
            break;
          }
        }
      }
    }

    if (!className || !instancePtr) {
      return null;
    }

    const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, expr.property);
    const fields = this.ctx.classGenGetClassFields(className);

    if (fieldInfoResult) {
      const fieldInfo = fieldInfoResult as FieldInfo;
      const fieldPtr = this.ctx.nextTemp();
      if (fields.length > 0) {
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`,
        );
        return this.loadFieldValue(fieldPtr, fieldInfoResult);
      } else {
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldInfo.index}`,
        );
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
        return value;
      }
    }

    // Bare method reference: `obj.method` (not a call). Methods use static
    // dispatch and aren't stored as struct fields. If the class has a method
    // with this name, return a truthy constant so truthiness checks like
    // `if (obj.method) obj.method()` work correctly.
    const classCount = this.ctx.getClassesCount();
    for (let ci = 0; ci < classCount; ci++) {
      const cls = this.ctx.getAstClassAt(ci);
      if (!cls || cls.name !== className) continue;
      for (let mi = 0; mi < cls.methods.length; mi++) {
        if (cls.methods[mi].name === expr.property) {
          return "1.0";
        }
      }
    }

    if (fields.length === 0) {
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 0`);
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      return value;
    } else {
      return this.ctx.emitError(
        `Field '${expr.property}' not found in class ${className}. Did you forget to declare it with a type annotation?`,
        expr.loc,
      );
    }
  }

  private loadFieldValue(
    fieldPtr: string,
    fieldInfo: FieldInfo,
    className?: string,
    fieldName?: string,
  ): string {
    let fieldType = fieldInfo.type;
    let tsType = fieldInfo.tsType;
    if (className && fieldName) {
      const ft = this.ctx.classGenGetFieldType(className, fieldName);
      const tst = this.ctx.classGenGetFieldTsType(className, fieldName);
      if (ft) fieldType = ft;
      if (tst) tsType = tst;
    }
    const primitive = this.loadPrimitiveFieldValue(fieldPtr, fieldType, tsType);
    if (primitive) return primitive;
    const collection = this.loadCollectionFieldValue(fieldPtr, fieldType, tsType);
    if (collection) return collection;
    return this.loadFallbackFieldValue(fieldPtr, fieldType, tsType);
  }

  private loadPrimitiveFieldValue(
    fieldPtr: string,
    fieldType: string,
    tsType: string | undefined,
  ): string | null {
    if (fieldType === "string") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, "i8*");
      if (tsType) {
        this.storeInterfaceMetadata(value, tsType);
        if (
          tsType !== "string" &&
          tsType !== "number" &&
          tsType !== "boolean" &&
          tsType.indexOf("|") === -1 &&
          tsType.indexOf("[") === -1
        ) {
          let concreteClass = this.findClassImplementingInterface(tsType);
          if (!concreteClass) {
            const ifaceDef = this.ctx.getInterfaceDeclByName(tsType);
            if (ifaceDef) {
              const allFields = this.ctx.getAllInterfaceFields(ifaceDef);
              const fieldNames: string[] = [];
              for (let fi = 0; fi < allFields.length; fi++) {
                const f = allFields[fi] as InterfaceField;
                fieldNames.push(f.name);
              }
              if (fieldNames.length > 0) {
                concreteClass = this.resolveConcreteClassByFields(fieldNames, fieldNames[0]);
              }
            }
          }
          if (concreteClass) {
            this.ctx.setActualClassType(value, concreteClass);
          }
        }
      }
      return value;
    } else if (fieldType === "string[]") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%StringArray*");
      return value;
    } else if (fieldType.endsWith("[]")) {
      const resolvedTsType = tsType || fieldType;
      const isObjectArray = isObjectArrayTsType(resolvedTsType);
      const value = this.ctx.nextTemp();
      if (isObjectArray) {
        this.ctx.emit(`${value} = load %ObjectArray*, %ObjectArray** ${fieldPtr}`);
        this.ctx.setVariableType(value, "%ObjectArray*");
      } else {
        this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
        this.ctx.setVariableType(value, "%Array*");
      }
      return value;
    } else if (fieldType === "boolean") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, "double");
      return value;
    }
    return null;
  }

  private loadCollectionFieldValue(
    fieldPtr: string,
    fieldType: string,
    tsType: string | undefined,
  ): string | null {
    if (tsType && tsType.startsWith("Map<string,")) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringMap*, %StringMap** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%StringMap*");
      return value;
    } else if (tsType && tsType.startsWith("Map<")) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Map*, %Map** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%Map*");
      return value;
    } else if (tsType === "Set<string>") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringSet*, %StringSet** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%StringSet*");
      return value;
    } else if (tsType && tsType.startsWith("Set<")) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Set*, %Set** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%Set*");
      return value;
    }
    return null;
  }

  private loadFallbackFieldValue(
    fieldPtr: string,
    fieldType: string,
    tsType: string | undefined,
  ): string {
    if (
      (fieldType === "double" || fieldType === "number") &&
      (!tsType || tsType === "number" || tsType === "boolean")
    ) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, "double");
      return value;
    } else if (tsType && tsType.endsWith("[]")) {
      const isObjectArray = isObjectArrayTsType(tsType);
      const value = this.ctx.nextTemp();
      if (isObjectArray) {
        this.ctx.emit(`${value} = load %ObjectArray*, %ObjectArray** ${fieldPtr}`);
        this.ctx.setVariableType(value, "%ObjectArray*");
      } else {
        this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
        this.ctx.setVariableType(value, "%Array*");
      }
      return value;
    }
    const value = this.ctx.nextTemp();
    let cleanTsType = tsType || "";
    if (cleanTsType.indexOf(" | ") !== -1) {
      cleanTsType = stripNullable(cleanTsType);
    }
    const classNode = this.ctx.classGenGetClassFields(cleanTsType);
    if (classNode.length > 0) {
      const structType = `%${cleanTsType}_struct*`;
      this.ctx.emit(`${value} = load ${structType}, ${structType}* ${fieldPtr}`);
      this.ctx.setVariableType(value, structType);
      this.ctx.setActualClassType(value, cleanTsType);
    } else {
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, "i8*");
      if (tsType) {
        let isKnownClass = false;
        const classCount = this.ctx.getClassesCount();
        for (let ci = 0; ci < classCount; ci++) {
          const classNode = this.ctx.getAstClassAt(ci);
          if (classNode && classNode.name === cleanTsType) {
            isKnownClass = true;
            break;
          }
        }
        if (isKnownClass) {
          this.ctx.setActualClassType(value, cleanTsType);
        } else {
          this.storeInterfaceMetadata(value, cleanTsType);
          const concreteClass = this.findClassImplementingInterface(cleanTsType);
          if (concreteClass) {
            this.ctx.setActualClassType(value, concreteClass);
          } else {
            const structuralMatch = this.findClassStructurallyMatchingInterface(cleanTsType);
            if (structuralMatch) {
              this.ctx.setActualClassType(value, structuralMatch);
            }
          }
        }
      }
    }
    return value;
  }

  private storeInterfaceMetadata(register: string, tsType: string): void {
    // Strip nullable suffixes so "Foo | undefined" matches interface "Foo"
    let lookupType = tsType;
    if (lookupType.indexOf(" | ") !== -1) {
      lookupType = stripNullable(lookupType);
    }
    if (this.ctx.interfaceStructGen?.hasInterface(lookupType)) {
      const interfaceInfo = this.ctx.interfaceStructGen?.getInterfaceStruct(lookupType);
      if (interfaceInfo) {
        const keys: string[] = [];
        const tsTypes: string[] = [];
        const types: string[] = [];
        const fields = interfaceInfo.fields as InterfaceFieldInfo[];
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i] as InterfaceFieldInfo;
          keys.push(f.name);
          tsTypes.push(f.tsType);
          types.push(f.llvmType);
        }
        this.ctx.setJsonObjectMetadata(register, { keys, types, tsTypes, interfaceType: tsType });
        return;
      }
    }
    const interfaceDefResult = this.getInterfaceDecl(lookupType);
    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      const allFields = this.ctx.getAllInterfaceFields(interfaceDef);
      for (let i = 0; i < allFields.length; i++) {
        const f = allFields[i] as { name: string; type: string };
        keys.push(stripOptional(f.name));
        tsTypes.push(f.type);
        types.push(tsTypeToLlvm(f.type));
      }
      this.ctx.setJsonObjectMetadata(register, { keys, types, tsTypes, interfaceType: undefined });
    } else if (lookupType === "Expression" || lookupType === "Statement") {
      this.ctx.setJsonObjectMetadata(register, {
        keys: ["type"],
        types: ["i8*"],
        tsTypes: ["string"],
        interfaceType: undefined,
      });
    } else {
      let strippedType = tsType;
      if (strippedType.includes(" | ")) {
        const parts = strippedType.split(" | ");
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i].trim();
          if (p.startsWith("{")) {
            strippedType = p;
            break;
          }
        }
      }
      if (strippedType.startsWith("{") && strippedType.endsWith("}")) {
        const inlineFields = this.parseInlineObjectTypeForAssertion(strippedType);
        if (inlineFields && inlineFields.length > 0) {
          const keys: string[] = [];
          const tsTypes: string[] = [];
          const types: string[] = [];
          for (let i = 0; i < inlineFields.length; i++) {
            const f = inlineFields[i] as InterfaceField;
            keys.push(f.name);
            tsTypes.push(f.type);
            types.push(tsTypeToLlvm(f.type));
          }
          this.ctx.setJsonObjectMetadata(register, {
            keys,
            types,
            tsTypes,
            interfaceType: undefined,
          });
        }
      }
    }
  }

  private handleJsonPropertyAccess(expr: MemberAccessNode, params: string[]): string {
    return handleJsonPropertyAccess(this.ctx, expr, params);
  }

  private handleNestedInterfaceField(fieldItem: string, tsType: string): string {
    return handleNestedInterfaceField(this.ctx, fieldItem, tsType);
  }

  private interfaceTsTypeToLlvm(t: string): string {
    const baseName = this.extractBaseTypeName(t);
    const props = this.ctx.getInterfaceProperties(baseName);
    const isInterface = props !== null && props.keys.length > 0;
    return canonicalTypeToLlvm(t, "struct_field", false, isInterface, "");
  }

  private extractJsonFieldValue(fieldItem: string): string {
    return extractJsonFieldValue(this.ctx, fieldItem);
  }

  private handleNestedJsonAccess(expr: MemberAccessNode, params: string[]): string | null {
    return handleNestedJsonAccess(this.ctx, expr, params);
  }

  private handleChainedInterfaceAccess(expr: MemberAccessNode, params: string[]): string | null {
    const innerPtr = this.ctx.generateExpression(expr.object, params);
    const innerType = this.ctx.getVariableType(innerPtr);

    if (innerType === "i8*") {
      const actualClass = this.ctx.getActualClassType(innerPtr);
      if (actualClass) {
        const fieldInfo = this.ctx.classGenGetFieldInfo(actualClass, expr.property);
        if (fieldInfo) {
          const castPtr = this.ctx.nextTemp();
          this.ctx.emit(`${castPtr} = bitcast i8* ${innerPtr} to %${actualClass}_struct*`);
          const fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${fieldPtr} = getelementptr inbounds %${actualClass}_struct, %${actualClass}_struct* ${castPtr}, i32 0, i32 ${fieldInfo.index}`,
          );
          const result = this.loadFieldValue(fieldPtr, fieldInfo, actualClass, expr.property);
          if (result && !this.ctx.getActualClassType(result)) {
            const fieldTsType = this.ctx.classGenGetFieldTsType(actualClass, expr.property);
            if (fieldTsType) {
              const classCount = this.ctx.getClassesCount();
              for (let ci = 0; ci < classCount; ci++) {
                const cls = this.ctx.getAstClassAt(ci);
                if (cls && cls.name === fieldTsType) {
                  this.ctx.setActualClassType(result, fieldTsType);
                  break;
                }
              }
            }
          }
          return result;
        }
      }
      if (this.ctx.hasJsonObjectMetadata(innerPtr)) {
        const interfaceType = this.ctx.getJsonObjectMetadataInterfaceType(innerPtr);
        if (interfaceType && interfaceType.length > 0) {
          if (this.ctx.interfaceStructGen?.hasInterface(interfaceType)) {
            const ifaceResult = this.accessObjectPropertyWithNamedInterface(
              innerPtr,
              expr.property,
              interfaceType,
            );
            if (ifaceResult !== null) return ifaceResult;
          }
        }
        const metaKeys = this.ctx.getJsonObjectMetadataKeys(innerPtr);
        const metaTypes = this.ctx.getJsonObjectMetadataTypes(innerPtr);
        const metaTsTypes = this.ctx.getJsonObjectMetadataTsTypes(innerPtr);
        if (metaKeys && metaTypes) {
          const propIndex = metaKeys.indexOf(expr.property);
          if (propIndex !== -1) {
            const resolvedClass = this.resolveConcreteClassByFields(metaKeys, expr.property);
            if (resolvedClass) {
              const fieldInfo = this.ctx.classGenGetFieldInfo(resolvedClass, expr.property);
              if (fieldInfo) {
                const castPtr = this.ctx.nextTemp();
                this.ctx.emit(`${castPtr} = bitcast i8* ${innerPtr} to %${resolvedClass}_struct*`);
                const fieldPtr = this.ctx.nextTemp();
                this.ctx.emit(
                  `${fieldPtr} = getelementptr inbounds %${resolvedClass}_struct, %${resolvedClass}_struct* ${castPtr}, i32 0, i32 ${fieldInfo.index}`,
                );
                this.ctx.setActualClassType(innerPtr, resolvedClass);
                const result = this.loadFieldValue(
                  fieldPtr,
                  fieldInfo,
                  resolvedClass,
                  expr.property,
                );
                return result;
              }
            }
            return this.accessObjectProperty(
              innerPtr,
              expr.property,
              metaKeys,
              metaTypes,
              metaTsTypes,
            );
          }
        }
      }
      if (expr.property === "type") {
        const structType = "{ i8* }";
        const typedPtr = this.ctx.nextTemp();
        this.ctx.emit(`${typedPtr} = bitcast i8* ${innerPtr} to ${structType}*`);
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 0`,
        );
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
        this.ctx.setVariableType(value, "i8*");
        return value;
      }
      return null;
    }

    if (!innerType || !innerType.startsWith("%") || !innerType.endsWith("*")) {
      return null;
    }

    let innerInterfaceName = innerType.substring(1, innerType.length - 1);

    const innerInterfaceDefResult = this.getInterfaceFromAST(innerInterfaceName);

    let propIndex: number = -1;
    let propType = "";
    let fieldPtr = "";

    if (innerInterfaceDefResult) {
      const innerInterfaceDef = innerInterfaceDefResult as InterfaceInfo;
      const innerProps = innerInterfaceDef.properties;
      if (!innerProps) {
        return null;
      }
      if (innerProps.length === 0) {
        return null;
      }

      for (let i = 0; i < innerProps.length; i++) {
        const p = innerProps[i] as InterfaceProperty;
        if (p.name === expr.property) {
          propIndex = i;
          break;
        }
      }
      if (propIndex === -1) return null;

      const innerPropField = innerProps[propIndex] as InterfaceProperty;
      propType = innerPropField.type;

      const implementingClass = this.resolveConcreteClassForRegister(innerPtr, innerInterfaceName);
      if (implementingClass) {
        const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
        if (classFieldInfo) {
          const classFieldInfoTyped = classFieldInfo as FieldInfo;
          const castPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${castPtr} = bitcast %${innerInterfaceName}* ${innerPtr} to %${implementingClass}_struct*`,
          );
          fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`,
          );
          if (classFieldInfoTyped.tsType) {
            propType = classFieldInfoTyped.tsType;
          }
        } else {
          fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`,
          );
        }
      } else {
        const interfaceFieldNames: string[] = [];
        for (let ii = 0; ii < innerProps.length; ii++) {
          const pp = innerProps[ii] as InterfaceProperty;
          interfaceFieldNames.push(pp.name);
        }
        const structuralClass = this.resolveConcreteClassByFields(
          interfaceFieldNames,
          expr.property,
        );
        if (structuralClass) {
          const classFieldInfo = this.ctx.classGenGetFieldInfo(structuralClass, expr.property);
          if (classFieldInfo) {
            const classFieldInfoTyped = classFieldInfo as FieldInfo;
            const castPtr = this.ctx.nextTemp();
            this.ctx.emit(
              `${castPtr} = bitcast %${innerInterfaceName}* ${innerPtr} to %${structuralClass}_struct*`,
            );
            fieldPtr = this.ctx.nextTemp();
            this.ctx.emit(
              `${fieldPtr} = getelementptr inbounds %${structuralClass}_struct, %${structuralClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`,
            );
            this.ctx.setActualClassType(innerPtr, structuralClass);
            if (classFieldInfoTyped.tsType) {
              propType = classFieldInfoTyped.tsType;
            }
          } else {
            fieldPtr = this.ctx.nextTemp();
            this.ctx.emit(
              `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`,
            );
          }
        } else {
          fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`,
          );
        }
      }
    } else if (innerInterfaceName.endsWith("_struct")) {
      const className = innerInterfaceName.slice(0, -7);
      const fieldInfo = this.ctx.classGenGetFieldInfo(className, expr.property);
      if (!fieldInfo) {
        return null;
      }

      if (fieldInfo.tsType) {
        propType = fieldInfo.tsType;
      } else if (fieldInfo.type === "double") {
        propType = "number";
      } else if (fieldInfo.type === "boolean") {
        propType = "boolean";
      } else {
        propType = fieldInfo.type;
      }

      fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${fieldInfo.index}`,
      );
    } else {
      return null;
    }

    if (expr.property === "nodePtr" || expr.property === "treePtr") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, "i8*");
      return value;
    } else if (propType === "string") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, "i8*");
      return value;
    } else if (propType === "number") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, "double");
      return value;
    } else if (propType === "boolean") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, "double");
      return value;
    } else if (propType === "string[]") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%StringArray*");
      return value;
    } else if (propType === "number[]" || propType === "boolean[]") {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%Array*");
      return value;
    } else if (propType.endsWith("[]")) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %ObjectArray*, %ObjectArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, "%ObjectArray*");
      return value;
    } else {
      let nestedTypeName = propType;
      if (nestedTypeName.endsWith("?")) {
        nestedTypeName = nestedTypeName.slice(0, nestedTypeName.length - 1);
      }
      if (nestedTypeName.indexOf(" | null") !== -1) {
        nestedTypeName = nestedTypeName.replace(" | null", "");
      }
      if (nestedTypeName.indexOf(" | undefined") !== -1) {
        nestedTypeName = nestedTypeName.replace(" | undefined", "");
      }
      if (nestedTypeName === "string") {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
        this.ctx.setVariableType(value, "i8*");
        return value;
      }
      if (nestedTypeName === "number") {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
        this.ctx.setVariableType(value, "double");
        return value;
      }
      const nestedInterfaceDefResult = this.getInterfaceFromAST(nestedTypeName);
      if (nestedInterfaceDefResult) {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load %${nestedTypeName}*, %${nestedTypeName}** ${fieldPtr}`);
        this.ctx.setVariableType(value, `%${nestedTypeName}*`);
        const concreteClass = this.findClassImplementingInterface(nestedTypeName);
        if (concreteClass) {
          this.ctx.setActualClassType(value, concreteClass);
        }
        return value;
      }
      const classFields = this.ctx.classGenGetClassFields(nestedTypeName);
      if (classFields && classFields.length > 0) {
        const value = this.ctx.nextTemp();
        this.ctx.emit(
          `${value} = load %${nestedTypeName}_struct*, %${nestedTypeName}_struct** ${fieldPtr}`,
        );
        this.ctx.setVariableType(value, `%${nestedTypeName}_struct*`);
        this.ctx.setActualClassType(value, nestedTypeName);
        return value;
      }
      let isAstClass = false;
      const classCount = this.ctx.getClassesCount();
      for (let ci = 0; ci < classCount; ci++) {
        const cls = this.ctx.getAstClassAt(ci);
        if (cls && cls.name === nestedTypeName) {
          isAstClass = true;
          break;
        }
      }
      if (isAstClass) {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
        this.ctx.setVariableType(value, "i8*");
        this.ctx.setActualClassType(value, nestedTypeName);
        return value;
      }
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, "i8*");
      if (nestedTypeName) {
        const concreteClass = this.findClassImplementingInterface(nestedTypeName);
        if (concreteClass) {
          this.ctx.setActualClassType(value, concreteClass);
        }
      }
      return value;
    }
  }

  private handleClassFieldChainedAccess(expr: MemberAccessNode, params: string[]): string | null {
    const innerExpr = expr.object as MemberAccessNode;
    const innerObjBase = innerExpr.object as ExprBase;

    if (innerObjBase.type !== "this") return null;

    const className = this.ctx.getCurrentClassName();
    if (!className) return null;

    const fieldName = innerExpr.property;
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, fieldName);
    if (!fieldInfoResult) return null;
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfo.tsType) return null;

    // Strip nullable suffixes so "Foo | undefined" produces valid LLVM type "%Foo"
    let cleanFieldType = fieldInfo.tsType;
    if (cleanFieldType.indexOf(" | ") !== -1) {
      cleanFieldType = stripNullable(cleanFieldType);
    }

    const interfaceDefResult = this.getInterfaceDecl(cleanFieldType);
    if (!interfaceDefResult) {
      const interfaceInfoResult = this.getInterfaceFromAST(cleanFieldType);
      if (!interfaceInfoResult) {
        const nestedClassFields = this.ctx.classGenGetClassFields(cleanFieldType);
        if (nestedClassFields !== undefined) {
          const innerPtrI8 = this.ctx.generateExpression(expr.object, params);
          const nestedFieldInfo = this.ctx.classGenGetFieldInfo(cleanFieldType, expr.property);
          if (nestedFieldInfo) {
            const nestedFieldInfoTyped = nestedFieldInfo as {
              index: number;
              type: string;
              tsType?: string;
            };
            const innerPtr = this.ctx.nextTemp();
            this.ctx.emit(`${innerPtr} = bitcast i8* ${innerPtrI8} to %${cleanFieldType}_struct*`);
            const fieldPtr = this.ctx.nextTemp();
            this.ctx.emit(
              `${fieldPtr} = getelementptr inbounds %${cleanFieldType}_struct, %${cleanFieldType}_struct* ${innerPtr}, i32 0, i32 ${nestedFieldInfoTyped.index}`,
            );
            return this.loadFieldValue(fieldPtr, nestedFieldInfo);
          }
        }
        return null;
      }

      const implementingClass = this.findClassImplementingInterface(cleanFieldType);
      if (implementingClass) {
        const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
        if (classFieldInfo) {
          const classFieldInfoTyped = classFieldInfo as FieldInfo;
          const innerPtr = this.ctx.generateExpression(expr.object, params);
          const resolvedClass = this.ctx.getActualClassType(innerPtr) || implementingClass;
          const castPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${castPtr} = bitcast %${cleanFieldType}* ${innerPtr} to %${resolvedClass}_struct*`,
          );
          const fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${fieldPtr} = getelementptr inbounds %${resolvedClass}_struct, %${resolvedClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`,
          );
          return this.loadFieldValue(fieldPtr, classFieldInfo);
        }
      }

      const interfaceInfo = interfaceInfoResult as InterfaceInfo;
      const ifInfoProps = interfaceInfo.properties;
      if (!ifInfoProps) {
        return null;
      }
      if (ifInfoProps.length === 0) {
        return null;
      }

      let propIndex: number = -1;
      for (let i = 0; i < ifInfoProps.length; i++) {
        const p = ifInfoProps[i] as InterfaceProperty;
        if (p.name === expr.property) {
          propIndex = i;
          break;
        }
      }
      if (propIndex === -1) return null;

      const innerPtr = this.ctx.generateExpression(expr.object, params);
      const propField = ifInfoProps[propIndex] as InterfaceProperty;
      const propType = propField.type;
      const llvmType = tsTypeToLlvm(propType);

      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${fieldPtr} = getelementptr inbounds %${cleanFieldType}, %${cleanFieldType}* ${innerPtr}, i32 0, i32 ${propIndex}`,
      );

      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load ${llvmType}, ${llvmType}* ${fieldPtr}`);
      this.ctx.setVariableType(value, llvmType);
      return value;
    }

    const implementingClass2 = this.findClassImplementingInterface(cleanFieldType);
    if (implementingClass2) {
      const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass2, expr.property);
      if (classFieldInfo) {
        const classFieldInfoTyped = classFieldInfo as FieldInfo;
        const innerPtr = this.ctx.generateExpression(expr.object, params);
        const resolvedClass2 = this.ctx.getActualClassType(innerPtr) || implementingClass2;
        const castPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${castPtr} = bitcast %${cleanFieldType}* ${innerPtr} to %${resolvedClass2}_struct*`,
        );
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${resolvedClass2}_struct, %${resolvedClass2}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`,
        );
        return this.loadFieldValue(fieldPtr, classFieldInfo);
      }
    }

    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    if (!interfaceDef.fields) return null;
    const allFields1628 = this.ctx.getAllInterfaceFields(interfaceDef);
    let propIndex: number = -1;
    let propTsType: string | undefined;
    for (let i = 0; i < allFields1628.length; i++) {
      const f = allFields1628[i] as { name: string; type: string };
      const fName = stripOptional(f.name);
      if (fName === expr.property) {
        propIndex = i;
        propTsType = f.type;
        break;
      }
    }
    if (propIndex === -1) return null;

    const innerPtr = this.ctx.generateExpression(expr.object, params);
    const llvmType = propTsType ? tsTypeToLlvm(propTsType) : "i8*";

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds %${cleanFieldType}, %${cleanFieldType}* ${innerPtr}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${llvmType}, ${llvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, llvmType);

    if (
      propTsType &&
      propTsType !== "string" &&
      propTsType !== "number" &&
      propTsType !== "boolean"
    ) {
      this.storeInterfaceMetadata(value, propTsType);
    }
    return value;
  }

  private handleIndexAccessPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    const indexAccess = expr.object as IndexAccessNode;
    const classElementType = this.getIndexAccessClassElementType(indexAccess.object);
    if (classElementType) {
      return this.handleClassArrayIndexPropertyAccess(expr, indexAccess, classElementType, params);
    }
    const elementInfoRaw = this.getObjectArrayElementInfo(indexAccess.object);
    if (!elementInfoRaw) return null;
    const elementInfo = elementInfoRaw as { keys: string[]; types: string[]; tsTypes: string[] };

    const propIndex = elementInfo.keys.indexOf(expr.property);
    if (propIndex === -1) {
      return null;
    }

    const arrayPtr = this.ctx.generateExpression(indexAccess.object, params);
    const indexDouble = this.ctx.generateExpression(indexAccess.index, params);

    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === "double" || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    } else if (indexType === "i64") {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = trunc i64 ${indexDouble} to i32`);
    }

    const structTypeFields = elementInfo.types.join(", ");
    const structType = `{ ${structTypeFields} }`;

    let contiguousStride = 0;
    const idxObj = indexAccess.object as { type: string };
    if (idxObj.type === "variable") {
      const arrVarName = (indexAccess.object as VariableNode).name;
      const numFields = this.ctx.symbolTable.getContiguousFieldCount(arrVarName);
      if (numFields > 0) contiguousStride = numFields * 8;
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);

    let elemTyped: string;
    if (contiguousStride > 0) {
      const indexI64 = this.ctx.nextTemp();
      this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);
      const offset = this.ctx.nextTemp();
      this.ctx.emit(`${offset} = mul i64 ${indexI64}, ${contiguousStride}`);
      const elemRaw = this.ctx.nextTemp();
      this.ctx.emit(`${elemRaw} = getelementptr inbounds i8, i8* ${data}, i64 ${offset}`);
      elemTyped = this.ctx.emitBitcast(elemRaw, "i8*", `${structType}*`);
    } else {
      const dataAsPtrs = this.ctx.emitBitcast(data, "i8*", "i8**");
      const elemPtrPtr = this.ctx.nextTemp();
      this.ctx.emit(`${elemPtrPtr} = getelementptr inbounds i8*, i8** ${dataAsPtrs}, i32 ${index}`);
      const elemPtr = this.ctx.nextTemp();
      this.ctx.emit(`${elemPtr} = load i8*, i8** ${elemPtrPtr}`);
      elemTyped = this.ctx.emitBitcast(elemPtr, "i8*", `${structType}*`);
    }

    const propType = elementInfo.types[propIndex];
    const propTsType = elementInfo.tsTypes[propIndex];
    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${elemTyped}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, propType);

    if (
      propTsType &&
      propTsType !== "string" &&
      propTsType !== "number" &&
      propTsType !== "boolean"
    ) {
      const interfaceInfoRaw = this.getKnownTypeProperties(propTsType);
      if (interfaceInfoRaw) {
        const interfaceInfo = interfaceInfoRaw as {
          keys: string[];
          types: string[];
          tsTypes: string[];
        };
        this.ctx.setJsonObjectMetadata(value, {
          keys: interfaceInfo.keys,
          types: interfaceInfo.types,
          tsTypes: interfaceInfo.tsTypes,
          interfaceType: undefined,
        });
      }
    }

    return value;
  }

  private getIndexAccessClassElementType(arrayExpr: Expression): string | null {
    if (arrayExpr.type === "variable") {
      const varName = (arrayExpr as VariableNode).name;
      const elementType = this.ctx.symbolTable.getObjectArrayElementType(varName);
      if (elementType && this.ctx.classGenGetClassFields(elementType).length > 0) {
        return elementType;
      }
      const paramType = this.getParameterTypeFromAST(varName);
      if (paramType && paramType.endsWith("[]")) {
        const elemType = paramType.slice(0, -2);
        if (this.ctx.classGenGetClassFields(elemType).length > 0) {
          return elemType;
        }
      }
    } else if (arrayExpr.type === "member_access") {
      const memberAccess = arrayExpr as MemberAccessNode;
      const memberObjBase = memberAccess.object as { type: string };
      let ownerClassName: string | null = null;
      if (memberObjBase.type === "this") {
        ownerClassName = this.ctx.getCurrentClassName();
      } else if (memberObjBase.type === "variable") {
        const vn = (memberAccess.object as VariableNode).name;
        if (this.ctx.symbolTable.isClass(vn)) {
          const cm = this.ctx.symbolTable.getClassInfo(vn);
          if (cm) ownerClassName = cm.className;
        }
      } else if (memberObjBase.type === "member_access") {
        const nestedType = this.resolveExpressionType(memberAccess.object);
        if (nestedType) ownerClassName = nestedType;
      }
      if (ownerClassName) {
        const fieldInfo = this.ctx.classGenGetFieldInfo(ownerClassName, memberAccess.property);
        if (fieldInfo) {
          const fi = fieldInfo as FieldInfo;
          if (fi.tsType) {
            let tsType = fi.tsType;
            if (tsType.indexOf(" | ") !== -1) {
              tsType = tsType
                .replace(/ \| undefined/g, "")
                .replace(/ \| null/g, "")
                .trim();
            }
            if (tsType.endsWith("[]")) {
              const elemType = tsType.substring(0, tsType.length - 2);
              if (this.ctx.classGenGetClassFields(elemType).length > 0) {
                return elemType;
              }
            }
          }
        }
      }
    }
    return null;
  }

  private handleClassArrayIndexPropertyAccess(
    expr: MemberAccessNode,
    indexAccess: IndexAccessNode,
    className: string,
    params: string[],
  ): string | null {
    const fieldInfo = this.ctx.classGenGetFieldInfo(className, expr.property);
    if (!fieldInfo) return null;
    const fi = fieldInfo as FieldInfo;
    const structType = `%${className}_struct`;

    const arrayPtr = this.ctx.generateExpression(indexAccess.object, params);
    const indexDouble = this.ctx.generateExpression(indexAccess.index, params);

    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === "double" || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    } else if (indexType === "i64") {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = trunc i64 ${indexDouble} to i32`);
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);
    const dataAsPtrs = this.ctx.emitBitcast(data, "i8*", "i8**");
    const elemPtrPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtrPtr} = getelementptr inbounds i8*, i8** ${dataAsPtrs}, i32 ${index}`);
    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = load i8*, i8** ${elemPtrPtr}`);
    const elemTyped = this.ctx.emitBitcast(elemPtr, "i8*", `${structType}*`);

    const fieldLlvmType = this.classFieldToLlvm(fi);
    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${elemTyped}, i32 0, i32 ${fi.index}`,
    );
    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${fieldLlvmType}, ${fieldLlvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, fieldLlvmType);

    return value;
  }

  private classFieldToLlvm(fi: FieldInfo): string {
    const ft = fi.type;
    if (ft === "string") return "i8*";
    if (ft === "boolean") return "double";
    if (ft === "string[]") return "%StringArray*";
    if (ft === "number[]") return "%Array*";
    if (ft === "boolean[]") return "%Array*";
    if (ft === "double" && fi.tsType) {
      let ts = fi.tsType;
      if (ts.indexOf(" | ") !== -1) {
        ts = ts
          .replace(/ \| undefined/g, "")
          .replace(/ \| null/g, "")
          .trim();
      }
      if (ts.endsWith("[]")) return "%ObjectArray*";
      if (ts.startsWith("Map<")) return ts.startsWith("Map<string,") ? "%StringMap*" : "%Map*";
      if (ts.startsWith("Set<")) return ts === "Set<string>" ? "%StringSet*" : "%Set*";
      const classFields = this.ctx.classGenGetClassFields(ts);
      if (classFields.length > 0) return `%${ts}_struct*`;
    }
    return "double";
  }

  private getKnownTypeProperties(
    typeName: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    let baseName = typeName;
    if (baseName.indexOf(" | ") !== -1) {
      const parts = baseName.split(" | ");
      baseName = parts[0].trim();
    }
    if (baseName === "Expression") {
      return {
        keys: ["type"],
        types: ["i8*"],
        tsTypes: ["string"],
      };
    }
    if (baseName === "Statement") {
      return {
        keys: ["type"],
        types: ["i8*"],
        tsTypes: ["string"],
      };
    }
    const ifaceInfo = this.getInterfaceInfo(baseName);
    if (ifaceInfo) {
      return ifaceInfo;
    }
    const typeAliasInfo = this.getTypeAliasInfo(baseName);
    if (typeAliasInfo) {
      return typeAliasInfo;
    }
    return null;
  }

  private getBuiltinAstTypeFields(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (name === "AssignmentStatement") {
      return {
        keys: ["type", "name", "value"],
        types: ["i8*", "i8*", "i8*"],
        tsTypes: ["'assignment'", "string", "Expression"],
      };
    }
    if (name === "VariableDeclaration") {
      return {
        keys: ["type", "kind", "name", "value", "declaredType"],
        types: ["i8*", "i8*", "i8*", "i8*", "i8*"],
        tsTypes: [
          "'variable_declaration'",
          "'let' | 'const'",
          "string",
          "Expression | null",
          "string",
        ],
      };
    }
    if (name === "ReturnStatement") {
      return {
        keys: ["type", "value"],
        types: ["i8*", "i8*"],
        tsTypes: ["'return'", "Expression"],
      };
    }
    if (name === "IfStatement") {
      return {
        keys: ["type", "condition", "thenBlock", "elseBlock"],
        types: ["i8*", "i8*", "i8*", "i8*"],
        tsTypes: ["'if'", "Expression", "BlockStatement", "BlockStatement | null"],
      };
    }
    if (name === "WhileStatement") {
      return {
        keys: ["type", "condition", "body"],
        types: ["i8*", "i8*", "i8*"],
        tsTypes: ["'while'", "Expression", "BlockStatement"],
      };
    }
    if (name === "ForStatement") {
      return {
        keys: ["type", "init", "condition", "update", "body"],
        types: ["i8*", "i8*", "i8*", "i8*", "i8*"],
        tsTypes: [
          "'for'",
          "VariableDeclaration | AssignmentStatement | null",
          "Expression | null",
          "AssignmentStatement | null",
          "BlockStatement",
        ],
      };
    }
    if (name === "ForOfStatement") {
      return {
        keys: ["type", "variableKind", "variableName", "iterable", "body"],
        types: ["i8*", "i8*", "i8*", "i8*", "i8*"],
        tsTypes: ["'for_of'", "'let' | 'const' | 'var'", "string", "Expression", "BlockStatement"],
      };
    }
    if (name === "BlockStatement") {
      return {
        keys: ["type", "statements"],
        types: ["i8*", "i8*"],
        tsTypes: ["'block'", "Statement[]"],
      };
    }
    if (name === "ThrowStatement") {
      return {
        keys: ["type", "argument"],
        types: ["i8*", "i8*"],
        tsTypes: ["'throw'", "Expression"],
      };
    }
    if (name === "TryStatement") {
      return {
        keys: ["type", "block", "handler", "finalizer"],
        types: ["i8*", "i8*", "i8*", "i8*"],
        tsTypes: ["'try'", "BlockStatement", "CatchClause | null", "BlockStatement | null"],
      };
    }
    if (name === "SwitchStatement") {
      return {
        keys: ["type", "discriminant", "cases"],
        types: ["i8*", "i8*", "i8*"],
        tsTypes: ["'switch'", "Expression", "SwitchCase[]"],
      };
    }
    if (name === "BreakStatement") {
      return {
        keys: ["type"],
        types: ["i8*"],
        tsTypes: ["'break'"],
      };
    }
    if (name === "ContinueStatement") {
      return {
        keys: ["type"],
        types: ["i8*"],
        tsTypes: ["'continue'"],
      };
    }
    return null;
  }

  private getInterfaceInfo(
    interfaceName: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    const ifaceProps = this.ctx.getInterfaceProperties(interfaceName);
    if (ifaceProps) {
      return {
        keys: ifaceProps.keys,
        types: ifaceProps.types,
        tsTypes: ifaceProps.tsTypes,
      };
    }
    const builtinFields = this.getBuiltinAstTypeFields(interfaceName);
    if (builtinFields) {
      return builtinFields;
    }
    return null;
  }

  private getTypeAliasInfo(
    typeName: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    const typeAliasPropsRaw = this.getTypeAliasCommonProperties(typeName);
    if (!typeAliasPropsRaw) return null;
    const typeAliasProps = typeAliasPropsRaw as { properties: InterfaceProperty[] };
    const taProps = typeAliasProps.properties;
    if (!taProps) return null;
    if (taProps.length === 0) return null;
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < taProps.length; i++) {
      const p = taProps[i] as InterfaceProperty;
      keys.push(stripOptional(p.name));
      tsTypes.push(p.type);
      types.push(tsTypeToLlvm(p.type));
    }
    return { keys, types, tsTypes };
  }

  private resolveMemberAccessType(expr: MemberAccessNode): string | null {
    const objectType = this.resolveExpressionType(expr.object);
    if (!objectType) return null;
    const fieldType = this.getInterfaceFieldType(objectType, expr.property);
    return fieldType;
  }

  private resolveExpressionType(expr: Expression): string | null {
    if (expr.type === "this") {
      const className = this.ctx.getCurrentClassName();
      return className || null;
    }
    if (expr.type === "variable") {
      const varName = (expr as VariableNode).name;
      if (this.hasObjectInfo(varName)) {
        return this.ctx.symbolTable.getInterfaceType(varName) || null;
      }
      const paramType = this.getParameterTypeFromAST(varName);
      if (paramType) {
        return paramType;
      }
      return null;
    }
    if (expr.type === "member_access") {
      const memberAccess = expr as MemberAccessNode;
      const memberAccessObjBase = memberAccess.object as ExprBase;
      if (memberAccessObjBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberAccess.property);
          const fieldInfo = fieldInfoResult as FieldInfo;
          if (fieldInfoResult && fieldInfo.tsType) {
            return fieldInfo.tsType;
          }
        }
        return null;
      }
      const objectType = this.resolveExpressionType(memberAccess.object);
      if (objectType) {
        const fieldType = this.getInterfaceFieldType(objectType, memberAccess.property);
        return fieldType;
      }
    }
    return null;
  }

  private getObjectArrayElementInfo(
    arrayExpr: Expression,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    // Canonical path: only fires when the INDEX will yield a scalar
    // interface/class element — i.e. the object is a depth-1 array. For
    // depth>1 (e.g. `P[][]` indexed once → `P[]`) the result is still an
    // array and the indexed-object-array element-info is not appropriate.
    const rich = this.ctx.typeOf(arrayExpr);
    if (rich && rich.arrayDepth === 1 && rich.fields) {
      return { keys: rich.fields.keys, types: rich.fields.types, tsTypes: rich.fields.tsTypes };
    }

    if (arrayExpr.type === "member_access") {
      const memberAccess = arrayExpr as MemberAccessNode;
      const memberAccessObjBase = memberAccess.object as ExprBase;
      const arrayType = this.resolveMemberAccessType(memberAccess);
      if (arrayType && arrayType.endsWith("[]")) {
        const elementType = arrayType.slice(0, -2);
        const interfaceInfoRaw = this.getInterfaceInfo(elementType);
        if (interfaceInfoRaw) {
          const interfaceInfo = interfaceInfoRaw as {
            keys: string[];
            types: string[];
            tsTypes: string[];
          };
          return interfaceInfo;
        }
      }
      if (memberAccessObjBase.type === "variable") {
        const varName = (memberAccess.object as VariableNode).name;
        const propName = memberAccess.property;
        const paramType = this.getParameterTypeFromAST(varName);
        if (paramType) {
          const fieldType = this.getInterfaceFieldType(paramType, propName);
          if (fieldType && fieldType.endsWith("[]")) {
            const fields = this.parseInlineObjectType(fieldType);
            if (fields) {
              const keys: string[] = [];
              const types: string[] = [];
              const tsTypes: string[] = [];
              for (let j = 0; j < fields.length; j++) {
                const f = fields[j] as { name: string; type: string };
                keys.push(stripOptional(f.name));
                tsTypes.push(f.type);
                if (f.type === "string") {
                  types.push("i8*");
                } else if (f.type === "number") {
                  types.push("double");
                } else if (f.type === "boolean") {
                  types.push("double");
                } else {
                  types.push("i8*");
                }
              }
              return { keys, types, tsTypes };
            }
          }
        }
        const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
        if (objMeta && objMeta.tsTypes) {
          const objKeys = objMeta.keys;
          const objTsTypes = objMeta.tsTypes;
          const idx = objKeys.indexOf(propName);
          if (idx !== -1) {
            const fieldType = objTsTypes[idx];
            if (fieldType && fieldType.endsWith("[]")) {
              const fields = this.parseInlineObjectType(fieldType);
              if (fields) {
                const keys: string[] = [];
                const types: string[] = [];
                const tsTypes: string[] = [];
                for (let j = 0; j < fields.length; j++) {
                  const f = fields[j] as { name: string; type: string };
                  keys.push(stripOptional(f.name));
                  tsTypes.push(f.type);
                  if (f.type === "string") {
                    types.push("i8*");
                  } else if (f.type === "number") {
                    types.push("double");
                  } else if (f.type === "boolean") {
                    types.push("double");
                  } else {
                    types.push("i8*");
                  }
                }
                return { keys, types, tsTypes };
              }
            }
          }
        }
      }
      if (memberAccessObjBase.type === "this") {
        const className = this.ctx.getCurrentClassName();
        if (className) {
          const fieldInfo = this.ctx.classGenGetFieldInfo(className, memberAccess.property);
          if (fieldInfo && fieldInfo.tsType && fieldInfo.tsType.endsWith("[]")) {
            const elementType = fieldInfo.tsType.slice(0, -2);
            const interfaceInfo = this.getInterfaceInfo(elementType);
            if (interfaceInfo) return interfaceInfo;
          }
        }
      }
      if (memberAccessObjBase.type === "member_access") {
        const nestedType = this.resolveExpressionType(memberAccess.object);
        if (nestedType) {
          const fieldInfo = this.ctx.classGenGetFieldInfo(nestedType, memberAccess.property);
          if (fieldInfo && fieldInfo.tsType && fieldInfo.tsType.endsWith("[]")) {
            const elementType = fieldInfo.tsType.slice(0, -2);
            const interfaceInfo = this.getInterfaceInfo(elementType);
            if (interfaceInfo) return interfaceInfo;
          }
        }
      }
    }
    if (arrayExpr.type === "variable") {
      const varName = (arrayExpr as VariableNode).name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return {
          keys: objArrayMeta.elementKeys,
          types: objArrayMeta.elementTypes,
          tsTypes: objArrayMeta.elementTsTypes || [],
        };
      }
      const elementType = this.ctx.symbolTable.getObjectArrayElementType(varName);
      if (elementType) {
        const interfaceInfo = this.getInterfaceInfo(elementType);
        if (interfaceInfo) {
          return interfaceInfo;
        }
      }
      const paramType = this.getParameterTypeFromAST(varName);
      if (paramType && paramType.endsWith("[]")) {
        const elemType = paramType.slice(0, -2);
        const interfaceInfo = this.getInterfaceInfo(elemType);
        if (interfaceInfo) {
          return interfaceInfo;
        }
      }
    }
    if (arrayExpr.type === "method_call") {
      const mc = arrayExpr as MethodCallNode;
      const mcObjBase = mc.object as { type: string };
      let className: string | null = null;
      if (mcObjBase.type === "variable") {
        const mcVar = mc.object as VariableNode;
        const concrete = this.ctx.symbolTable.getConcreteClass(mcVar.name);
        if (concrete) {
          className = concrete;
        } else {
          const classInfo = this.ctx.symbolTable.getClassInfo(mcVar.name);
          if (classInfo) className = classInfo.className;
        }
      } else if (mcObjBase.type === "this") {
        className = this.ctx.getCurrentClassName();
      } else if (mcObjBase.type === "member_access") {
        const nestedType = this.resolveExpressionType(mc.object);
        if (nestedType) className = nestedType;
      }
      if (className) {
        const retType = this.ctx.getMethodReturnType(className, mc.method);
        if (retType && retType.endsWith("[]")) {
          const elemType = retType.slice(0, -2);
          const interfaceInfo = this.getInterfaceInfo(elemType);
          if (interfaceInfo) return interfaceInfo;
        }
      }
    }
    if (arrayExpr.type === "call") {
      const ce = arrayExpr as CallNode;
      const fnName = this.ctx.resolveImportAlias(ce.name);
      const ast = this.ctx.getAst();
      if (ast) {
        for (let fi = 0; fi < ast.functions.length; fi++) {
          const fn = ast.functions[fi] as FunctionNode;
          if (fn && fn.name === fnName && fn.returnType) {
            const rt = fn.returnType;
            if (rt.endsWith("[]")) {
              const elemType = rt.slice(0, -2);
              const interfaceInfo = this.getInterfaceInfo(elemType);
              if (interfaceInfo) return interfaceInfo;
            }
            break;
          }
        }
      }
    }
    return null;
  }

  private parseInlineObjectType(type: string): { name: string; type: string }[] | null {
    if (!type.startsWith("{") || !type.endsWith("}[]")) {
      return null;
    }
    const inner = type.slice(1, type.length - 3).trim();
    const parts = this.splitByTopLevelSemicolon(inner);
    const fields: { name: string; type: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = this.findTopLevelColon(part);
      if (colonIdx === -1) continue;
      const name = part.slice(0, colonIdx).trim();
      const t = part.slice(colonIdx + 1).trim();
      fields.push({ name, type: t });
    }
    return fields.length > 0 ? fields : null;
  }

  private getParameterTypeFromAST(paramName: string): string | null {
    return this.ctx.getParameterTypeFromAST(paramName);
  }

  private getInterfaceFieldType(interfaceName: string, fieldName: string): string | null {
    if (interfaceName.startsWith("{") && interfaceName.endsWith("}")) {
      const inlineFields = this.parseInlineObjectTypeForAssertion(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const f = inlineFields[i];
          let fName = f.name;
          if (fName.endsWith("?")) {
            fName = fName.slice(0, fName.length - 1);
          }
          if (fName === fieldName) {
            return f.type;
          }
        }
      }
      return null;
    }
    return this.ctx.getInterfaceFieldType(interfaceName, fieldName);
  }

  private extractNestedJsonFieldValue(fieldItem: string): string {
    return extractNestedJsonFieldValue(this.ctx, fieldItem);
  }

  private handleObjectPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    let objPtr: string = "";
    let keys: string[] = [];
    let types: string[] = [];
    let tsTypes: string[] | undefined = undefined;

    if (!expr.object) {
      return null;
    }
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase ? exprObjBase.type : null;
    if (exprObjType === null || exprObjType === undefined) {
      return null;
    }
    if (exprObjType === "variable") {
      const varName = (expr.object as VariableNode).name;
      const isJSON = this.ctx.symbolTable.isJSON(varName);
      if (isJSON) {
        return null;
      }
      const isObject = this.ctx.symbolTable.isObject(varName);
      if (isObject) {
        const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
        if (ifaceType && ifaceType.length > 0) {
          const implementingClass = this.resolveConcreteClass(varName, ifaceType);
          if (implementingClass) {
            const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
            if (classFieldInfo) {
              const objPtrPtr = this.ctx.getVariableAlloca(varName)!;
              const objPtrRaw = this.ctx.nextTemp();
              this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${objPtrPtr}`);
              const castPtr = this.ctx.nextTemp();
              this.ctx.emit(
                `${castPtr} = bitcast i8* ${objPtrRaw} to %${implementingClass}_struct*`,
              );
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(
                `${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`,
              );
              return this.loadFieldValue(fieldPtr, classFieldInfo);
            }
          }
          // Bare method reference: `obj.method` (not a call) used in truthiness
          // checks like `obj.method ? obj.method() : fallback`. Methods aren't
          // stored as struct fields, so field lookup above misses them. Return a
          // truthy constant when the interface declares this method — with static
          // dispatch the method always exists if the interface declares it.
          const ifaceDecl = this.getInterfaceDecl(ifaceType);
          if (ifaceDecl && ifaceDecl.methods) {
            for (let mi = 0; mi < ifaceDecl.methods.length; mi++) {
              if (ifaceDecl.methods[mi].name === expr.property) {
                return "1.0";
              }
            }
          }
          if (this.ctx.interfaceStructGen?.hasInterface(ifaceType)) {
            const objPtrPtr = this.ctx.getVariableAlloca(varName)!;
            const objPtrRaw = this.ctx.nextTemp();
            this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${objPtrPtr}`);
            const ifaceResult = this.accessObjectPropertyWithNamedInterface(
              objPtrRaw,
              expr.property,
              ifaceType,
            );
            if (ifaceResult !== null) return ifaceResult;
          }
        }
      }
      // Try getObjectInfo regardless of isObject result - handles inline object literals
      if (this.hasObjectInfo(varName)) {
        const metaKeys = this.ctx.symbolTable.getObjectMetadataKeys(varName);
        const metaTypes = this.ctx.symbolTable.getObjectMetadataTypes(varName);
        const metaTsTypes = this.ctx.symbolTable.getObjectMetadataTsTypes(varName);
        if (metaKeys && metaTypes) {
          keys = metaKeys;
          types = metaTypes;
          tsTypes = metaTsTypes;
          const objPtrPtr = this.ctx.getVariableAlloca(varName)!;
          objPtr = this.ctx.nextTemp();
          this.ctx.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);
        }
      }
    } else if (exprObjType === "object") {
      const metadataResult = this.ctx.getObjectMetadata(expr.object as ObjectNode);
      const metadata = metadataResult as ObjectMetadata;
      keys = metadata.keys;
      types = metadata.types;
      objPtr = this.ctx.generateExpression(expr.object, params);
    } else if (exprObjType === "method_call") {
      const result = this.handleMethodCallPropertyAccess(expr, params);
      if (result !== null) return result;
      return null;
    } else {
      return null;
    }

    if (keys.length === 0 || !objPtr) return null;

    const propIndex = keys.indexOf(expr.property);
    if (propIndex === -1) {
      const objDesc = exprObjType === "variable" ? (expr.object as VariableNode).name : "literal";
      return this.ctx.emitError(
        `Unknown property: ${expr.property} on object ${objDesc}. Available properties: ${keys.join(", ")}`,
        expr.loc,
      );
    }

    const propType = types[propIndex];
    const propTsType = tsTypes ? tsTypes[propIndex] : undefined;
    const structType = `{ ${types.join(", ")} }`;

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, propType);

    if (
      propTsType &&
      propTsType !== "string" &&
      propTsType !== "number" &&
      propTsType !== "boolean"
    ) {
      const interfaceInfoRaw = this.getKnownTypeProperties(propTsType);
      if (interfaceInfoRaw) {
        const interfaceInfo = interfaceInfoRaw as {
          keys: string[];
          types: string[];
          tsTypes: string[];
        };
        this.ctx.setJsonObjectMetadata(value, {
          keys: interfaceInfo.keys,
          types: interfaceInfo.types,
          tsTypes: interfaceInfo.tsTypes,
          interfaceType: undefined,
        });
      }
    }

    return value;
  }

  private handleMethodCallPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    const methodCall = expr.object as MethodCallNode;
    if (methodCall.method !== "parse") return null;
    const methodCallObjBase = methodCall.object as ExprBase;
    if (methodCallObjBase.type !== "variable") return null;
    if ((methodCall.object as VariableNode).name !== "JSON") return null;

    this.ctx.setUsesJson(true);
    const jsonObjPtr = this.ctx.generateExpression(expr.object, params);
    const fieldNameStr = this.ctx.stringGen.doCreateStringConstant(expr.property);

    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldItem} = call i8* @csyyjson_obj_get(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`,
    );

    return this.extractJsonFieldValue(fieldItem);
  }

  private handleMethodCallResultPropertyAccess(
    expr: MemberAccessNode,
    params: string[],
  ): string | null {
    const methodCall = expr.object as MethodCallNode;

    if (methodCall.method !== "get") return null;
    const methodCallObjBase = methodCall.object as ExprBase;
    if (methodCallObjBase.type !== "member_access") return null;

    const memberExpr = methodCall.object as MemberAccessNode;
    const memberExprObjBase = memberExpr.object as ExprBase;
    if (memberExprObjBase.type !== "this") return null;
    const classNameForLookup = this.ctx.getCurrentClassName();
    if (!classNameForLookup) return null;

    const fieldInfoResult = this.ctx.classGenGetFieldInfo(classNameForLookup, memberExpr.property);
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const mapParsed = parseMapTypeString(fieldInfo.tsType);
    if (!mapParsed) return null;

    const valueType = mapParsed.valueType;
    const interfaceDefResult = this.getInterfaceDecl(valueType);
    if (!interfaceDefResult) return null;
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    if (!interfaceDef.fields) return null;
    const allFields2328 = this.ctx.getAllInterfaceFields(interfaceDef);

    const objPtr = this.ctx.generateExpression(expr.object, params);

    let propIndex: number = -1;
    for (let i = 0; i < allFields2328.length; i++) {
      const f = allFields2328[i] as { name: string; type: string };
      if (f.name === expr.property) {
        propIndex = i;
        break;
      }
    }
    if (propIndex === -1) {
      const fieldNames: string[] = [];
      for (let i = 0; i < allFields2328.length; i++) {
        const field = allFields2328[i] as { name: string; type: string };
        fieldNames.push(field.name);
      }
      return this.ctx.emitError(
        `Unknown property: ${expr.property} on interface ${valueType}. Available properties: ${fieldNames.join(", ")}`,
        expr.loc,
      );
    }

    const propField = allFields2328[propIndex] as { name: string; type: string };
    const propType = tsTypeToLlvm(propField.type);
    const structTypes: string[] = [];
    for (let i = 0; i < allFields2328.length; i++) {
      const field = allFields2328[i] as { name: string; type: string };
      structTypes.push(tsTypeToLlvm(field.type));
    }
    const structType = `{ ${structTypes.join(", ")} }`;

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, propType);

    return value;
  }

  private findFunctionReturnInterfaceFields(callExpr: CallNode): object[] | null {
    const ast = this.ctx.getAst();
    if (!ast || !ast.functions) return null;

    let func: FunctionNode | null = null;
    for (const f of ast.functions) {
      if ((f as FunctionNode).name === callExpr.name) {
        func = f as FunctionNode;
        break;
      }
    }
    if (!func || !func.returnType) return null;

    const returnType = stripNullable(func.returnType);
    if (returnType.startsWith("{")) return null;

    const interfaceDef = this.getInterfaceDecl(returnType);
    if (!interfaceDef) return null;
    return this.ctx.getAllInterfaceFields(interfaceDef as InterfaceDeclaration);
  }

  private handleCallResultPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    const callExpr = expr.object as CallNode;
    const allFields = this.findFunctionReturnInterfaceFields(callExpr);
    if (!allFields) return null;

    let propIndex: number = -1;
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as { name: string; type: string };
      if (stripOptional(f.name) === expr.property) {
        propIndex = i;
        break;
      }
    }
    if (propIndex === -1) return null;

    const propField = allFields[propIndex] as { name: string; type: string };
    const propType = tsTypeToLlvm(propField.type);
    const structTypes: string[] = [];
    for (let i = 0; i < allFields.length; i++) {
      const field = allFields[i] as { name: string; type: string };
      structTypes.push(tsTypeToLlvm(field.type));
    }
    const structType = `{ ${structTypes.join(", ")} }`;

    const objPtr = this.ctx.generateExpression(expr.object, params);

    const typedPtr = this.ctx.emitBitcast(objPtr, "i8*", `${structType}*`);
    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.emitLoad(propType, fieldPtr);
    this.ctx.setVariableType(value, propType);

    // Propagate interface metadata when the field is of named-interface type.
    // Without this, subsequent chained access (e.g. `make().inner.x`) hits
    // handleChainedInterfaceAccess with no metadata, falls back to anonymous
    // struct access, and emits wrong types (`{ i8* }` instead of `%Inner`).
    const propTsType = stripOptional(propField.type);
    if (propType === "i8*") {
      const innerIfaceDef = this.getInterfaceDecl(propTsType);
      if (innerIfaceDef) {
        const innerFields = this.ctx.getAllInterfaceFields(innerIfaceDef as InterfaceDeclaration);
        const keys: string[] = [];
        const types: string[] = [];
        const tsTypes: string[] = [];
        for (const f of innerFields) {
          const ff = f as { name: string; type: string };
          keys.push(stripOptional(ff.name));
          types.push(tsTypeToLlvm(ff.type));
          tsTypes.push(ff.type);
        }
        this.ctx.setJsonObjectMetadata(value, {
          keys,
          types,
          tsTypes,
          interfaceType: propTsType,
        });
      }
    }

    return value;
  }

  private handleLengthProperty(expr: MemberAccessNode, params: string[]): string {
    return handleLengthProperty(this.ctx, expr, params);
  }

  private isProcessArgvLength(expr: MemberAccessNode): boolean {
    return isProcessArgvLength(expr);
  }

  private getArrayLength(obj: Expression, params: string[], arrayType: string): string {
    return getArrayLength(this.ctx, obj, params, arrayType);
  }

  private getStringArrayLength(stringArrayPtr: string): string {
    return getStringArrayLength(this.ctx, stringArrayPtr);
  }

  private getStringArrayLengthFromPtr(ptr: string): string {
    return getStringArrayLengthFromPtr(this.ctx, ptr);
  }

  private handleMemberAccessLength(expr: MemberAccessNode, params: string[]): string | null {
    return handleMemberAccessLength(this.ctx, expr, params);
  }

  private getArrayLengthFromPtr(arrayPtr: string, arrayType: string): string {
    return getArrayLengthFromPtr(this.ctx, arrayPtr, arrayType);
  }

  private getStringLength(obj: Expression, params: string[]): string {
    return getStringLength(this.ctx, obj, params);
  }

  private handleSizeProperty(expr: MemberAccessNode, params: string[]): string | null {
    return handleSizeProperty(this.ctx, expr, params);
  }

  private handleResponseProperty(expr: MemberAccessNode): string | null {
    return handleResponseProperty(this.ctx, expr);
  }

  private handleStatProperty(expr: MemberAccessNode): string | null {
    return handleStatProperty(this.ctx, expr);
  }

  private handlePathParseProperty(expr: MemberAccessNode): string | null {
    return handlePathParseProperty(this.ctx, expr);
  }

  private handleSpawnSyncResultProperty(expr: MemberAccessNode): string | null {
    return handleSpawnSyncResultProperty(this.ctx, expr);
  }

  private handleUrlProperty(expr: MemberAccessNode): string | null {
    return handleUrlProperty(this.ctx, expr);
  }

  private handleParameterPropertyAccess(expr: MemberAccessNode, params: string[]): string {
    const prop = expr.property;
    if (!prop || prop.length === 0) {
      return this.ctx.emitError("member access with empty property name", expr.loc);
    }
    const exprObjBase = expr.object as ExprBase;
    if (!exprObjBase || !exprObjBase.type || exprObjBase.type.length === 0) {
      return this.ctx.emitError(
        `cannot access property '${prop}' — object expression has no type`,
        expr.loc,
      );
    }
    const exprObjType = exprObjBase.type;
    if (exprObjType !== "variable") {
      if (
        exprObjType === "member_access" ||
        exprObjType === "method_call" ||
        exprObjType === "index_access" ||
        exprObjType === "call"
      ) {
        const innerPtr = this.ctx.generateExpression(expr.object, params);
        const innerType = this.ctx.getVariableType(innerPtr);
        if (innerType === "i8*") {
          if (this.ctx.hasJsonObjectMetadata(innerPtr)) {
            const interfaceType = this.ctx.getJsonObjectMetadataInterfaceType(innerPtr);
            if (interfaceType) {
              if (this.ctx.interfaceStructGen?.hasInterface(interfaceType)) {
                const ifaceResult = this.accessObjectPropertyWithNamedInterface(
                  innerPtr,
                  expr.property,
                  interfaceType,
                );
                if (ifaceResult !== null) return ifaceResult;
              }
            }
            const metaKeys = this.ctx.getJsonObjectMetadataKeys(innerPtr);
            const metaTypes = this.ctx.getJsonObjectMetadataTypes(innerPtr);
            const metaTsTypes = this.ctx.getJsonObjectMetadataTsTypes(innerPtr);
            if (metaKeys && metaTypes) {
              const propIndex = metaKeys.indexOf(expr.property);
              if (propIndex !== -1) {
                return this.accessObjectProperty(
                  innerPtr,
                  expr.property,
                  metaKeys,
                  metaTypes,
                  metaTsTypes,
                );
              }
            }
          }
          // Rearchitect: consult the canonical resolver before falling back
          // to the opaque { i8* } struct type. For method-call/call/member
          // returns of a declared interface, this routes through the
          // named-interface path (correct struct layout, metadata propagated
          // for nested access). Unblocks `s.build().inner.v` chains.
          const rich = this.ctx.typeOf(expr.object);
          if (rich && rich.arrayDepth === 0 && rich.base) {
            const rt = rich.base;
            if (this.ctx.interfaceStructGen?.hasInterface(rt)) {
              const ifaceResult = this.accessObjectPropertyWithNamedInterface(
                innerPtr,
                expr.property,
                rt,
              );
              if (ifaceResult !== null) return ifaceResult;
            }
          }
          const structType = "{ i8* }";
          const typedPtr = this.ctx.nextTemp();
          this.ctx.emit(`${typedPtr} = bitcast i8* ${innerPtr} to ${structType}*`);
          const fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 0`,
          );
          const value = this.ctx.nextTemp();
          this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
          this.ctx.setVariableType(value, "i8*");
          return value;
        }
        if (innerType && innerType.startsWith("%") && innerType.endsWith("*")) {
          const innerTypeName = innerType.substring(1, innerType.length - 1);
          if (innerTypeName.endsWith("_struct")) {
            const className = innerTypeName.slice(0, -7);
            const fieldInfo = this.ctx.classGenGetFieldInfo(className, expr.property);
            if (fieldInfo) {
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(
                `${fieldPtr} = getelementptr inbounds ${innerType.slice(0, innerType.length - 1)}, ${innerType} ${innerPtr}, i32 0, i32 ${fieldInfo.index}`,
              );
              return this.loadFieldValue(fieldPtr, fieldInfo);
            }
          }
          const interfaceDefResult = this.getInterfaceFromAST(innerTypeName);
          if (interfaceDefResult) {
            const interfaceDef = interfaceDefResult as InterfaceInfo;
            const innerIfaceProps = interfaceDef.properties;
            if (!innerIfaceProps || innerIfaceProps.length === 0) {
              return this.ctx.emitError(
                `cannot access property '${prop}' on interface '${innerTypeName}' — interface has no fields`,
                expr.loc,
              );
            }
            let propIndex: number = -1;
            for (let i = 0; i < innerIfaceProps.length; i++) {
              const p = innerIfaceProps[i] as InterfaceProperty;
              if (p.name === expr.property) {
                propIndex = i;
                break;
              }
            }
            if (propIndex !== -1) {
              const propField = innerIfaceProps[propIndex] as InterfaceProperty;
              const implementingClass = this.findClassImplementingInterface(innerTypeName);
              if (implementingClass) {
                const classFieldInfo = this.ctx.classGenGetFieldInfo(
                  implementingClass,
                  expr.property,
                );
                if (classFieldInfo) {
                  const castPtr = this.ctx.nextTemp();
                  this.ctx.emit(
                    `${castPtr} = bitcast %${innerTypeName}* ${innerPtr} to %${implementingClass}_struct*`,
                  );
                  const fieldPtr = this.ctx.nextTemp();
                  this.ctx.emit(
                    `${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`,
                  );
                  const fieldInfo: FieldInfo = {
                    index: classFieldInfo.index,
                    type: classFieldInfo.type,
                    tsType: classFieldInfo.tsType || propField.type,
                  };
                  return this.loadFieldValue(fieldPtr, fieldInfo);
                }
              }
              return this.ctx.emitError(
                `cannot resolve field '${prop}' on interface '${innerTypeName}' — no implementing class found`,
                expr.loc,
              );
            }
            return this.ctx.emitError(
              `property '${prop}' does not exist on interface '${innerTypeName}'`,
              expr.loc,
            );
          }
          return innerPtr;
        }
        return innerPtr;
      }
      if (exprObjBase.type === "type_assertion") {
        return this.ctx.emitError(
          `unresolved property '${prop}' on type_assertion expression`,
          expr.loc,
        );
      }
      return this.ctx.emitError(
        `unresolved property '${prop}' on expression of type '${exprObjBase.type}'`,
        expr.loc,
      );
    }

    const varName = (expr.object as VariableNode).name;
    if (this.ctx.symbolTable.isObject(varName) && this.hasObjectInfo(varName)) {
      const objectMetadata = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objectMetadata) {
        return this.accessObjectWithMetadata(varName, expr.property, objectMetadata);
      }
    }

    const symbolInterfaceType = this.ctx.symbolTable.getInterfaceType(varName);
    if (symbolInterfaceType && symbolInterfaceType.length > 0) {
      const varAlloca = this.ctx.getVariableAlloca(varName);
      if (varAlloca) {
        const objPtrRaw = this.ctx.nextTemp();
        this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${varAlloca}`);
        const ifaceType = symbolInterfaceType;
        if (ifaceType && ifaceType.length > 0) {
          if (this.ctx.interfaceStructGen?.hasInterface(ifaceType)) {
            const ifaceResult = this.accessObjectPropertyWithNamedInterface(
              objPtrRaw,
              expr.property,
              ifaceType,
            );
            if (ifaceResult !== null) return ifaceResult;
          }
        }
        const interfaceDef = this.getInterfaceFromAST(ifaceType);
        if (interfaceDef) {
          const interfaceDefTyped = interfaceDef as InterfaceInfo;
          const interfaceProps = interfaceDefTyped.properties;
          if (!interfaceProps) {
            // no properties - skip
          } else if (interfaceProps.length === 0) {
            // empty properties - skip
          } else {
            let propIndex: number = -1;
            let propType = "";
            for (let i = 0; i < interfaceProps.length; i++) {
              const prop = interfaceProps[i] as InterfaceProperty;
              if (prop.name === expr.property) {
                propIndex = i;
                propType = prop.type;
                break;
              }
            }
            if (propIndex !== -1) {
              const implementingClass = this.findClassImplementingInterface(ifaceType);
              if (implementingClass) {
                const classFieldInfo = this.ctx.classGenGetFieldInfo(
                  implementingClass,
                  expr.property,
                );
                if (classFieldInfo) {
                  const castPtr = this.ctx.nextTemp();
                  this.ctx.emit(
                    `${castPtr} = bitcast i8* ${objPtrRaw} to %${implementingClass}_struct*`,
                  );
                  const fieldPtr = this.ctx.nextTemp();
                  this.ctx.emit(
                    `${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`,
                  );
                  return this.loadFieldValue(fieldPtr, classFieldInfo);
                }
              }
              const structTypes: string[] = [];
              for (let i = 0; i < interfaceProps.length; i++) {
                const prop = interfaceProps[i] as InterfaceProperty;
                structTypes.push(this.interfaceTsTypeToLlvm(prop.type));
              }
              const structType = `{ ${structTypes.join(", ")} }`;
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(
                `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`,
              );
              const llvmFieldType = this.interfaceTsTypeToLlvm(propType);
              const value = this.ctx.nextTemp();
              if (propType === "string" || propType.endsWith("[]") || propType.startsWith("%")) {
                this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                this.ctx.setVariableType(value, "i8*");
              } else if (propType === "number" || propType === "boolean") {
                this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                this.ctx.setVariableType(value, "double");
              } else {
                this.ctx.emit(`${value} = load ${llvmFieldType}, ${llvmFieldType}* ${fieldPtr}`);
                this.ctx.setVariableType(value, llvmFieldType);
                this.storeInterfaceMetadata(value, propType);
              }
              return value;
            }
          }
        }
      }
    }

    if (params.indexOf(varName) !== -1) {
      const paramInterfaceType = this.getParameterTypeFromAST(varName);
      if (paramInterfaceType && paramInterfaceType.length > 0) {
        if (paramInterfaceType.startsWith("{")) {
          const inlineFields = this.parseInlineObjectTypeForAssertion(paramInterfaceType);
          if (inlineFields) {
            let propIndex: number = -1;
            let propType = "";
            for (let pi = 0; pi < inlineFields.length; pi++) {
              const field = inlineFields[pi] as InterfaceField;
              if (field.name === expr.property) {
                propIndex = pi;
                propType = field.type;
                break;
              }
            }
            if (propIndex !== -1) {
              const paramPtr = this.ctx.getVariableAlloca(varName);
              if (paramPtr) {
                const structTypes: string[] = [];
                for (let i = 0; i < inlineFields.length; i++) {
                  const f = inlineFields[i] as InterfaceField;
                  structTypes.push(this.interfaceTsTypeToLlvm(f.type));
                }
                const structType = `{ ${structTypes.join(", ")} }`;
                const objPtrRaw = this.ctx.nextTemp();
                this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
                const objPtr = this.ctx.nextTemp();
                this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);
                const fieldPtr = this.ctx.nextTemp();
                this.ctx.emit(
                  `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`,
                );
                const fieldInfo: FieldInfo = {
                  index: propIndex,
                  type: this.interfaceTsTypeToLlvm(propType),
                  tsType: propType,
                };
                return this.loadFieldValue(fieldPtr, fieldInfo);
              }
            }
          }
        }
        const interfaceDefResult = this.getInterfaceFromAST(paramInterfaceType);
        if (interfaceDefResult) {
          const interfaceDef = interfaceDefResult as InterfaceInfo;
          const ifaceProps = interfaceDef.properties;
          if (!ifaceProps || ifaceProps.length === 0) {
            const fallbackAlloca = this.ctx.getVariableAlloca(varName);
            if (fallbackAlloca) {
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = load i8*, i8** ${fallbackAlloca}`);
              this.ctx.setVariableType(objPtr, "i8*");
              return objPtr;
            }
            return this.ctx.emitError(
              `cannot access property '${prop}' on parameter '${varName}' — interface '${paramInterfaceType}' has no properties`,
              expr.loc,
            );
          }
          let propIndex: number = -1;
          for (let pi = 0; pi < ifaceProps.length; pi++) {
            const p = ifaceProps[pi] as InterfaceProperty;
            if (p.name === expr.property) {
              propIndex = pi;
              break;
            }
          }
          if (propIndex !== -1) {
            const propField = ifaceProps[propIndex] as InterfaceProperty;
            let propType = propField.type;
            const paramPtr = this.ctx.getVariableAlloca(varName);
            if (paramPtr) {
              const implementingClass = this.findClassImplementingInterface(paramInterfaceType);
              if (implementingClass) {
                const classFieldInfo = this.ctx.classGenGetFieldInfo(
                  implementingClass,
                  expr.property,
                );
                if (classFieldInfo) {
                  const classFieldInfoTyped = classFieldInfo as FieldInfo;
                  const objPtrRaw = this.ctx.nextTemp();
                  this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
                  const objPtr = this.ctx.nextTemp();
                  this.ctx.emit(
                    `${objPtr} = bitcast i8* ${objPtrRaw} to %${implementingClass}_struct*`,
                  );
                  const fieldPtr = this.ctx.nextTemp();
                  this.ctx.emit(
                    `${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${objPtr}, i32 0, i32 ${classFieldInfoTyped.index}`,
                  );
                  if (classFieldInfoTyped.tsType) {
                    propType = classFieldInfoTyped.tsType;
                  }
                  const fieldInfo: FieldInfo = {
                    index: classFieldInfoTyped.index,
                    type: classFieldInfoTyped.type,
                    tsType: propType,
                  };
                  return this.loadFieldValue(fieldPtr, fieldInfo);
                }
              }
              if (this.ctx.interfaceStructGen?.hasInterface(paramInterfaceType)) {
                const objPtrRaw = this.ctx.nextTemp();
                this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
                const ifaceResult = this.accessObjectPropertyWithNamedInterface(
                  objPtrRaw,
                  expr.property,
                  paramInterfaceType,
                );
                if (ifaceResult !== null) return ifaceResult;
              }
              const structTypes: string[] = [];
              for (let i = 0; i < ifaceProps.length; i++) {
                const prop = ifaceProps[i] as InterfaceProperty;
                structTypes.push(this.interfaceTsTypeToLlvm(prop.type));
              }
              const structType = `{ ${structTypes.join(", ")} }`;
              const objPtrRaw = this.ctx.nextTemp();
              this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(
                `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`,
              );
              const llvmFieldType = this.interfaceTsTypeToLlvm(propType);
              if (expr.property === "nodePtr" || expr.property === "treePtr") {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                this.ctx.setVariableType(value, "i8*");
                return value;
              } else if (propType === "string") {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                this.ctx.setVariableType(value, "i8*");
                return value;
              } else if (propType === "number") {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                this.ctx.setVariableType(value, "double");
                return value;
              } else if (propType === "boolean") {
                const boolVal = this.ctx.nextTemp();
                this.ctx.emit(`${boolVal} = load double, double* ${fieldPtr}`);
                this.ctx.setVariableType(boolVal, "double");
                return boolVal;
              } else if (propType === "string[]") {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
                this.ctx.setVariableType(value, "%StringArray*");
                return value;
              } else if (propType.endsWith("[]")) {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
                this.ctx.setVariableType(value, "%Array*");
                return value;
              } else {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load ${llvmFieldType}, ${llvmFieldType}* ${fieldPtr}`);
                this.ctx.setVariableType(value, llvmFieldType);
                this.storeInterfaceMetadata(value, propType);
                return value;
              }
            }
          }
        }
      }

      const fallbackAlloca = this.ctx.getVariableAlloca(varName);
      if (fallbackAlloca) {
        const objPtr = this.ctx.nextTemp();
        this.ctx.emit(`${objPtr} = load i8*, i8** ${fallbackAlloca}`);
        this.ctx.setVariableType(objPtr, "i8*");
        const structType = "{ i8* }";
        const typedPtr = this.ctx.nextTemp();
        this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 0`,
        );
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
        this.ctx.setVariableType(value, "i8*");
        return value;
      }
      return this.ctx.emitError(
        `cannot access property '${prop}' on '${varName}' — no type information available`,
        expr.loc,
      );
    }

    const fallbackAlloca = this.ctx.getVariableAlloca(varName);
    if (fallbackAlloca) {
      const objPtr = this.ctx.nextTemp();
      this.ctx.emit(`${objPtr} = load i8*, i8** ${fallbackAlloca}`);
      this.ctx.setVariableType(objPtr, "i8*");
      return objPtr;
    }
    return this.ctx.emitError(
      `cannot access property '${prop}' on '${varName}' — variable has no type information or alloca`,
      expr.loc,
    );
  }

  private handleTypeAssertionPropertyAccess(
    expr: MemberAccessNode,
    params: string[],
  ): string | null {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "type_assertion") return null;

    const assertion = expr.object as TypeAssertionNode;
    const assertedType = assertion.assertedType;
    const property = expr.property;

    let fields: InterfaceField[] = [];

    if (assertedType.startsWith("{")) {
      const inlineFields = parseInlineObjectTypeForAssertion(assertedType);
      if (inlineFields && inlineFields.length >= 2) {
        const fieldNames: string[] = [];
        for (let fi = 0; fi < inlineFields.length; fi++) {
          fieldNames.push(inlineFields[fi].name);
        }
        const matchedIface = this.ctx.findInterfaceForFields(fieldNames);
        if (matchedIface) {
          const objPtr = this.ctx.generateExpression(assertion.expression, params);
          const ifaceResult = this.accessObjectPropertyWithNamedInterface(
            objPtr,
            property,
            matchedIface,
          );
          if (ifaceResult !== null) return ifaceResult;
        }
      }
      const syntheticExpr: MemberAccessNode = {
        type: "member_access",
        object: assertion.expression,
        property: property,
        loc: expr.loc,
      };
      return this.generate(syntheticExpr, params);
    } else {
      if (assertedType.length > 0 && this.ctx.interfaceStructGen?.hasInterface(assertedType)) {
        const objPtr = this.ctx.generateExpression(assertion.expression, params);
        const ifaceResult = this.accessObjectPropertyWithNamedInterface(
          objPtr,
          property,
          assertedType,
        );
        if (ifaceResult !== null) return ifaceResult;
      }
      const builtinFields = this.getBuiltinAstTypeFields(assertedType);
      if (builtinFields) {
        fields = [];
        for (let bfi = 0; bfi < builtinFields.keys.length; bfi++) {
          fields.push({ name: builtinFields.keys[bfi], type: builtinFields.tsTypes[bfi] });
        }
      } else {
        const ifaceProps = this.ctx.getInterfaceProperties(assertedType);
        if (!ifaceProps) {
          const syntheticExpr: MemberAccessNode = {
            type: "member_access",
            object: assertion.expression,
            property: property,
            loc: expr.loc,
          };
          return this.generate(syntheticExpr, params);
        }
        fields = [];
        for (let ipf = 0; ipf < ifaceProps.keys.length; ipf++) {
          // fields[].type needs TS types since it's passed to tsTypeToLlvm() below
          fields.push({ name: ifaceProps.keys[ipf], type: ifaceProps.tsTypes[ipf] });
        }
      }
    }

    let fieldIndex: number = -1;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      if (f.name === property) {
        fieldIndex = i;
        break;
      }
    }
    if (fieldIndex === -1) return null;

    const field = fields[fieldIndex] as { name: string; type: string };
    const fieldLlvmType = tsTypeToLlvm(field.type);

    const types: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      types.push(tsTypeToLlvm(f.type));
    }
    const structType = `{ ${types.join(", ")} }`;

    const objPtr = this.ctx.generateExpression(assertion.expression, params);

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${fieldIndex}`,
    );

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${fieldLlvmType}, ${fieldLlvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, fieldLlvmType);

    if (
      field.type &&
      ["string", "number", "boolean"].indexOf(field.type) === -1 &&
      !field.type.endsWith("[]")
    ) {
      this.storeInterfaceMetadata(value, field.type);
    }

    return value;
  }

  private parseInlineObjectTypeForAssertion(typeStr: string): InterfaceField[] | null {
    return parseInlineObjectTypeForAssertion(typeStr);
  }

  private splitByTopLevelSemicolon(str: string): string[] {
    return splitByTopLevelSemicolon(str);
  }

  private findTopLevelColon(str: string): number {
    return findTopLevelColon(str);
  }

  private accessObjectWithMetadata(
    varName: string,
    property: string,
    metadata: ObjectMetadata,
  ): string {
    return accessObjectWithMetadata(this.ctx, varName, property, metadata);
  }

  private accessInterfacePropertyWithNamedStruct(
    varName: string,
    property: string,
    interfaceType: string,
  ): string {
    const interfaceInfo = this.ctx.interfaceStructGen?.getInterfaceStruct(interfaceType);
    if (!interfaceInfo) {
      return this.ctx.emitError(
        `Interface ${interfaceType} not found in interface struct generator`,
      );
    }

    let propIndex: number = -1;
    let propLlvmType = "";
    let propTsType = "";
    const fields = interfaceInfo.fields as InterfaceFieldInfo[];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] as InterfaceFieldInfo;
      if (field.name === property) {
        propIndex = i;
        propLlvmType = field.llvmType;
        propTsType = field.tsType;
        break;
      }
    }

    if (propIndex === -1) {
      const fieldNames: string[] = [];
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i] as { name: string; tsType: string; llvmType: string };
        fieldNames.push(f.name);
      }
      return this.ctx.emitError(
        `Property '${property}' not found on interface '${interfaceType}'. Available properties: ${fieldNames.join(", ")}`,
      );
    }

    const structType = `%${interfaceType}`;
    const varPtr = this.ctx.getVariableAlloca(varName);
    if (!varPtr) {
      return this.ctx.emitError(`Variable ${varName} not found in symbol table`);
    }

    const objPtrRaw = this.ctx.nextTemp();
    this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${varPtr}`);

    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propLlvmType}, ${propLlvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, propLlvmType);

    if (
      propTsType &&
      ["string", "number", "boolean"].indexOf(propTsType) === -1 &&
      !propTsType.endsWith("[]")
    ) {
      this.storeInterfaceMetadata(value, propTsType);
    }

    return value;
  }

  private accessObjectPropertyWithNamedInterface(
    objPtr: string,
    property: string,
    interfaceType: string,
  ): string | null {
    const concreteClass =
      this.ctx.getActualClassType(objPtr) || this.findClassImplementingInterface(interfaceType);
    if (concreteClass) {
      const classFieldInfo = this.ctx.classGenGetFieldInfo(concreteClass, property);
      if (classFieldInfo) {
        const castPtr = this.ctx.nextTemp();
        this.ctx.emit(`${castPtr} = bitcast i8* ${objPtr} to %${concreteClass}_struct*`);
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${fieldPtr} = getelementptr inbounds %${concreteClass}_struct, %${concreteClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`,
        );
        const result = this.loadFieldValue(fieldPtr, classFieldInfo, concreteClass, property);
        return result;
      }
    }

    const objMeta = this.ctx.getJsonObjectMetadata(objPtr);
    if (objMeta) {
      const checkInfo = this.ctx.interfaceStructGen?.getInterfaceStruct(interfaceType);
      if (checkInfo) {
        const checkFields = checkInfo.fields as InterfaceFieldInfo[];
        if (objMeta.keys.length !== checkFields.length) {
          return null;
        }
        for (let li = 0; li < objMeta.keys.length; li++) {
          if (objMeta.keys[li] !== (checkFields[li] as InterfaceFieldInfo).name) {
            return null;
          }
        }
      }
    }

    const interfaceInfo = this.ctx.interfaceStructGen?.getInterfaceStruct(interfaceType);
    if (!interfaceInfo) {
      return this.ctx.emitError(
        `Interface ${interfaceType} not found in interface struct generator`,
      );
    }

    let propIndex: number = -1;
    let propLlvmType = "";
    let propTsType = "";
    const fields = interfaceInfo.fields as InterfaceFieldInfo[];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] as InterfaceFieldInfo;
      if (field.name === property) {
        propIndex = i;
        propLlvmType = field.llvmType;
        propTsType = field.tsType;
        break;
      }
    }

    if (propIndex === -1) {
      return null;
    }

    const structType = `%${interfaceType}`;
    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
    );

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propLlvmType}, ${propLlvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, propLlvmType);

    if (
      propTsType &&
      ["string", "number", "boolean"].indexOf(propTsType) === -1 &&
      !propTsType.endsWith("[]")
    ) {
      this.storeInterfaceMetadata(value, propTsType);
    }

    return value;
  }

  private accessObjectProperty(
    objPtr: string,
    property: string,
    keys: string[],
    types: string[],
    _tsTypes?: string[],
  ): string {
    return accessObjectProperty(this.ctx, objPtr, property, keys, types, _tsTypes);
  }
}
