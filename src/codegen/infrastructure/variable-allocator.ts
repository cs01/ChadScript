import {
  Expression,
  NewNode,
  AST,
  VariableDeclaration,
  InterfaceDeclaration,
  InterfaceField,
  ObjectNode,
  IndexAccessNode,
  MemberAccessNode,
  VariableNode,
  TypeAliasDeclaration,
  TypeAssertionNode,
  MethodCallNode,
  CallNode,
  CommonField,
  BinaryNode,
  MapNode,
  SetNode,
  AwaitExpressionNode,
  SourceLocation,
} from "../../ast/types.js";
import {
  SymbolKind,
  SymbolTable,
  ObjectMetadata,
  MapMetadata,
  ClassMetadata,
  ClosureMetadata,
  SetMetadata,
  Symbol as SymbolEntry,
  ObjectArrayMetadata,
  createPointerAllocaMetadata,
  createInterfacePointerAllocaMetadata,
  createObjectMetadata,
  createObjectMetadataWithInterface,
  createObjectMetadataWithPointerAlloca,
  createObjectMetadataWithInterfaceAndPointerAlloca,
  createClassMetadata,
  createClosureMetadataSymbol,
  createMapMetadataSymbol,
  createSetMetadataSymbol,
  createObjectArrayMetadataSymbol,
  createUnionMetadata,
  SymbolMetadata,
} from "./symbol-table.js";
import type { TypeChecker } from "../../typescript/type-checker.js";
import { TypeResolver, UnionCommonFields } from "./type-resolver/index.js";
import {
  stripOptional,
  stripNullable,
  tsTypeToLlvm,
  tsTypeToLlvmJson,
  parseMapTypeString,
  parseSetTypeString,
  parseArrayTypeString,
} from "./type-system.js";
import type { ResolvedType } from "./type-system.js";

interface ExprBase {
  type: string;
}

export enum VarKind {
  DeclaredInterface,
  StringArray,
  MapGetInterface,
  FunctionInterfaceReturn,
  MethodInterfaceReturn,
  MethodArrayReturn,
  MemberAccessInterface,
  Await,
  Promise,
  Uint8Array,
  ClassInstance,
  TypedJsonInterface,
  Response,
  JSONObject,
  Object,
  Map,
  Set,
  ObjectArray,
  Array,
  Regex,
  String,
  ArrowFunction,
  IndexedObjectArray,
  ArrayMethodReturn,
  Pointer,
  Null,
  Numeric,
}

export interface VarClassification {
  kind: VarKind;
  declaredInterfaceType: string | null;
  mapGetInterfaceType: string | null;
  functionInterfaceReturn: string | null;
  methodInterfaceReturn: string | null;
  methodArrayReturn: string | null;
  memberAccessInterfaceType: string | null;
  typedJsonInterface: string | null;
  indexedObjectType: { keys: string[]; types: string[]; tsTypes: string[] } | null;
  arrayMethodReturnType: { keys: string[]; types: string[]; tsTypes: string[] } | null;
}

interface ArrowFunctionGeneratorLike {
  generateArrowFunction(
    expr: Expression | null,
    params: string[],
    returnType?: string | { paramTypes?: string[]; returnType?: string },
    scopeVarNames?: string[],
    scopeVarTypes?: string[],
  ): string;
  getClosureInfoForLambda(lambdaName: string): ClosureInfoResult | null;
}

interface ClosureInfoResult {
  captures: CaptureInfo[];
  envStructName: string;
}

interface CaptureInfo {
  name: string;
  llvmType: string;
}

interface ExpressionGeneratorLike {
  arrowFunctionGen: ArrowFunctionGeneratorLike;
}

interface ObjectMetadataResult {
  keys: string[];
  types: string[];
}

interface MapTypeInfo {
  keyType: string;
  valueType: string;
}

interface SetTypeInfo {
  valueType: string;
}

interface MethodArrayFieldInfo {
  name: string;
  type: string;
}

interface MethodArrayReturnInfo {
  elementType: string;
  fields: MethodArrayFieldInfo[];
}

export interface VariableAllocatorContext {
  nextTemp(): string;
  nextAllocaReg(varName: string): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
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
  generateExpression(expr: Expression, params: string[]): string;
  resolveExpressionType(expr: Expression): ResolvedType | null;
  getObjectArrayElementType(expr: Expression): string | null;
  isJSONParseExpression(expr: Expression): boolean;
  getVariableType(name: string): string | undefined;
  setCurrentDeclaredMapType(type: string | undefined): void;
  getCurrentDeclaredMapType(): string | undefined;
  setCurrentDeclaredSetType(type: string | undefined): void;
  getCurrentDeclaredSetType(): string | undefined;
  getTypedJsonInterface(expr: Expression): string | null;
  getFunctionCallInterfaceReturn(expr: Expression): string | null;
  getMethodCallInterfaceReturn(expr: Expression): string | null;
  getMethodCallArrayReturn(expr: Expression): string | null;
  getJSONParseInterface(expr: Expression): string | null;
  getObjectMetadata(objExpr: ObjectNode): { keys: string[]; types: string[] };
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  emitWarning(message: string, loc?: SourceLocation, suggestion?: string): void;
  getAst(): AST | undefined;
  hasClassGen(): boolean;
  classGenGetFieldInfo(
    className: string | null,
    fieldName: string | null,
  ): { index: number; type: string; tsType?: string } | null;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  readonly symbolTable: SymbolTable;
  setExpectedArrayElementType(type: "string" | "number" | "boolean" | "pointer" | null): void;
  getExpectedArrayElementType(): "string" | "number" | "boolean" | "pointer" | null;
  setCurrentDeclaredInterfaceType(type: string | undefined): void;
  getCurrentDeclaredInterfaceType(): string | undefined;
  getCurrentClassName(): string | null;
  typeResolverGetInterface(name: string): InterfaceDeclaration | null;
  typeResolverGetTypeAlias(name: string): TypeAliasDeclaration | null;
  typeResolverGetMapGetInterfaceType(expr: Expression): string | null;
  typeResolverGetUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[] };
  typeResolverAreTypesCompatible(type1: string, type2: string): boolean;
  typeResolverNormalizeType(type: string): string;
  typeResolverResolveArrayMethodReturnType(expr: Expression): ObjectMetadata | null;
  readonly typeResolver?: TypeResolver;
  readonly arrowFunctionGen: ArrowFunctionGeneratorLike;
  ensureDouble(value: string): string;
  getI64EligibleVars(): string[];
}

export class VariableAllocator {
  constructor(private ctx: VariableAllocatorContext) {}

  private isKnownClass(name: string): boolean {
    if (!name) return false;
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return false;
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      if (cls && cls.name === name) return true;
    }
    return false;
  }

  private isI64Eligible(name: string): boolean {
    const eligible = this.ctx.getI64EligibleVars();
    for (let i = 0; i < eligible.length; i++) {
      if (eligible[i] === name) return true;
    }
    return false;
  }

  private getInterface(name: string): InterfaceDeclaration | null {
    if (!name) return null;
    const result = this.ctx.typeResolver?.getInterface(name);
    if (result) {
      return result;
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.interfaces) return null;
    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i] as InterfaceDeclaration;
      if (!iface || !iface.name) continue;
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  private getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[] {
    const result: InterfaceField[] = [];
    if (iface.extends && iface.extends.length > 0) {
      for (let i = 0; i < iface.extends.length; i++) {
        const parentName = iface.extends[i];
        const parent = this.getInterface(parentName);
        if (parent) {
          const parentFields = this.getAllInterfaceFields(parent);
          for (let j = 0; j < parentFields.length; j++) {
            result.push(parentFields[j]);
          }
        }
      }
    }
    for (let i = 0; i < iface.fields.length; i++) {
      result.push(iface.fields[i]);
    }
    return result;
  }

  private getTypeAlias(name: string): TypeAliasDeclaration | null {
    if (!name) return null;
    const result = this.ctx.typeResolver?.getTypeAlias(name);
    if (result) {
      return result;
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.typeAliases) return null;
    for (let i = 0; i < ast.typeAliases.length; i++) {
      const ta = ast.typeAliases[i] as TypeAliasDeclaration;
      if (!ta || !ta.name) continue;
      if (ta.name === name) {
        return ta;
      }
    }
    return null;
  }

  private isStringEnum(typeName: string): boolean {
    return false;
  }

  private isStringLiteralUnion(typeName: string): boolean {
    if (!typeName || typeName.indexOf("|") === -1) return false;
    const parts = typeName.split("|");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part.length === 0) continue;
      if (part === "null" || part === "undefined") continue;
      if (
        (part.startsWith("'") && part.endsWith("'")) ||
        (part.startsWith('"') && part.endsWith('"'))
      )
        continue;
      return false;
    }
    return true;
  }

  private isEnumType(typeName: string): boolean {
    const ast = this.ctx.getAst();
    if (!ast || !ast.enums) return false;
    let checkType = typeName;
    if (checkType.indexOf(" | ") !== -1) {
      const parts = checkType.split(" | ");
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j].trim();
        if (part !== "undefined" && part !== "null") {
          checkType = part;
          break;
        }
      }
    }
    for (let i = 0; i < ast.enums.length; i++) {
      if (ast.enums[i].name === checkType) {
        return true;
      }
    }
    return false;
  }

  private isUnionOfInterfaceTypes(typeStr: string): boolean {
    if (!typeStr) return false;
    if (this.isEnumType(typeStr)) return false;
    let resolvedType = typeStr;
    const typeAlias = this.getTypeAlias(typeStr);
    if (typeAlias && typeAlias.unionMembers && typeAlias.unionMembers.length > 0) {
      resolvedType = typeAlias.unionMembers.join(" | ");
    }
    if (resolvedType.indexOf("|") === -1) {
      if (this.getTypeAlias(resolvedType)) return true;
      const firstChar = resolvedType.charAt(0);
      if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
        if (this.isEnumType(resolvedType)) return false;
        return true;
      }
      return false;
    }
    const parts = resolvedType.split("|");
    let hasNonPrimitive = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part === "undefined" || part === "null") continue;
      if (part === "string" || part === "number" || part === "boolean") continue;
      if (this.isEnumType(part)) continue;
      if (this.getInterface(part)) return true;
      if (this.getTypeAlias(part)) return true;
      const firstChar = part.charAt(0);
      if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
        hasNonPrimitive = true;
      }
    }
    return hasNonPrimitive;
  }

  classifyVariable(
    isString: boolean,
    isStringArray: boolean,
    isObjectArray: boolean,
    isArray: boolean,
    isMap: boolean,
    isSet: boolean,
    isRegex: boolean,
    isPromise: boolean,
    isClassInstance: boolean,
    isUint8Array: boolean,
    isResponse: boolean,
    isObject: boolean,
    isJSONObject: boolean,
    isAwait: boolean,
    isArrowFunction: boolean,
    isPointer: boolean,
    isNull: boolean,
    declaredInterfaceType: string | null,
    mapGetInterfaceType: string | null,
    functionInterfaceReturn: string | null,
    methodInterfaceReturn: string | null,
    methodArrayReturn: string | null,
    memberAccessInterfaceType: string | null,
    typedJsonInterface: string | null,
    indexedObjectType: { keys: string[]; types: string[]; tsTypes: string[] } | null,
    arrayMethodReturnType: { keys: string[]; types: string[]; tsTypes: string[] } | null,
  ): VarClassification {
    let kind: VarKind;

    if (declaredInterfaceType) {
      kind = VarKind.DeclaredInterface;
    } else if (isStringArray) {
      kind = VarKind.StringArray;
    } else if (mapGetInterfaceType) {
      kind = VarKind.MapGetInterface;
    } else if (functionInterfaceReturn) {
      kind = VarKind.FunctionInterfaceReturn;
    } else if (methodInterfaceReturn) {
      kind = VarKind.MethodInterfaceReturn;
    } else if (methodArrayReturn) {
      kind = VarKind.MethodArrayReturn;
    } else if (memberAccessInterfaceType) {
      kind = VarKind.MemberAccessInterface;
    } else if (isAwait) {
      kind = VarKind.Await;
    } else if (isPromise) {
      kind = VarKind.Promise;
    } else if (isUint8Array) {
      kind = VarKind.Uint8Array;
    } else if (isClassInstance) {
      kind = VarKind.ClassInstance;
    } else if (typedJsonInterface) {
      kind = VarKind.TypedJsonInterface;
    } else if (isResponse) {
      kind = VarKind.Response;
    } else if (isJSONObject) {
      kind = VarKind.JSONObject;
    } else if (isObject) {
      kind = VarKind.Object;
    } else if (isMap) {
      kind = VarKind.Map;
    } else if (isSet) {
      kind = VarKind.Set;
    } else if (isObjectArray) {
      kind = VarKind.ObjectArray;
    } else if (isArray) {
      kind = VarKind.Array;
    } else if (isRegex) {
      kind = VarKind.Regex;
    } else if (isString) {
      kind = VarKind.String;
    } else if (isArrowFunction) {
      kind = VarKind.ArrowFunction;
    } else if (indexedObjectType) {
      kind = VarKind.IndexedObjectArray;
    } else if (arrayMethodReturnType) {
      kind = VarKind.ArrayMethodReturn;
    } else if (isPointer) {
      kind = VarKind.Pointer;
    } else if (isNull) {
      kind = VarKind.Null;
    } else {
      kind = VarKind.Numeric;
    }

    return {
      kind,
      declaredInterfaceType,
      mapGetInterfaceType,
      functionInterfaceReturn,
      methodInterfaceReturn,
      methodArrayReturn,
      memberAccessInterfaceType,
      typedJsonInterface,
      indexedObjectType,
      arrayMethodReturnType,
    };
  }

  allocate(stmt: VariableDeclaration, params: string[]): void {
    const existingScope = this.ctx.symbolTable.getScope(stmt.name);
    if (existingScope === "global" && stmt.value !== null) {
      const value = this.ctx.generateExpression(stmt.value, params);
      const globalPtr = this.ctx.symbolTable.getAlloca(stmt.name) || "";
      const llvmType = this.ctx.symbolTable.getType(stmt.name) || "i8*";
      if (llvmType.indexOf("*") !== -1) {
        this.ctx.emit(`store ${llvmType} ${value}, ${llvmType}* ${globalPtr}`);
      } else if (
        llvmType === "%Array" ||
        llvmType === "%StringArray" ||
        llvmType === "%Map" ||
        llvmType === "%StringMap" ||
        llvmType === "%Set" ||
        llvmType === "%StringSet"
      ) {
        const loadedValue = this.ctx.nextTemp();
        this.ctx.emit(`${loadedValue} = load ${llvmType}, ${llvmType}* ${value}`);
        this.ctx.emit(`store ${llvmType} ${loadedValue}, ${llvmType}* ${globalPtr}`);
      } else if (llvmType === "double") {
        const coerced = this.ctx.ensureDouble(value);
        this.ctx.emit(`store double ${coerced}, double* ${globalPtr}`);
      } else {
        this.ctx.emit(`store ${llvmType} ${value}, ${llvmType}* ${globalPtr}`);
      }
      return;
    }

    const stmtValueAsVar = stmt.value as { type?: string; name?: string };
    const isAstNullLiteral =
      stmtValueAsVar && stmtValueAsVar.type === "variable" && stmtValueAsVar.name === "null";
    if (stmt.value === null || isAstNullLiteral) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      const baseType = stmt.declaredType ? stripNullable(stmt.declaredType) : "";
      if (baseType === "string") {
        this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.String, "local");
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
      } else if (baseType === "boolean") {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind.Number, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
      } else if (baseType === "number") {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind.Number, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
      } else if (baseType === "string[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%StringArray*",
          SymbolKind.StringArray,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        this.ctx.emit(`store %StringArray* null, %StringArray** ${allocaReg}`);
      } else if (baseType === "number[]" || baseType === "boolean[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%Array*",
          SymbolKind.Array,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %Array*`);
        this.ctx.emit(`store %Array* null, %Array** ${allocaReg}`);
      } else if (baseType.endsWith("[]")) {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%ObjectArray*",
          SymbolKind.ObjectArray,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
        this.ctx.emit(`store %ObjectArray* null, %ObjectArray** ${allocaReg}`);
      } else {
        let isInterfaceType = false;
        if (baseType && this.getInterface(baseType)) {
          isInterfaceType = true;
        }
        const isInlineObjectType = baseType && baseType.startsWith("{");
        const isStringEnumType = baseType && this.isStringEnum(baseType);
        if (isInterfaceType || isInlineObjectType || isStringEnumType) {
          if (isInlineObjectType) {
            const inlineFields = this.parseInlineObjectType(baseType);
            if (inlineFields && inlineFields.length > 0) {
              const keys: string[] = [];
              const types: string[] = [];
              const tsTypes: string[] = [];
              for (let fi = 0; fi < inlineFields.length; fi++) {
                const fieldRaw = inlineFields[fi];
                if (!fieldRaw) continue;
                const field = fieldRaw as { name: string; type: string };
                if (!field.name || !field.type) continue;
                keys.push(stripOptional(field.name));
                types.push(this.convertTsType(field.type));
                tsTypes.push(field.type);
              }
              this.ctx.defineVariableWithMetadata(
                stmt.name,
                allocaReg,
                "i8*",
                SymbolKind.Object,
                "local",
                createObjectMetadata({ keys, types, tsTypes }),
              );
              this.ctx.emit(`${allocaReg} = alloca i8*`);
              this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
              return;
            }
          }
          if (isInterfaceType) {
            const interfaceDefResult = this.getInterface(baseType);
            if (interfaceDefResult) {
              const interfaceDef = interfaceDefResult as InterfaceDeclaration;
              const keys: string[] = [];
              const types: string[] = [];
              const tsTypes: string[] = [];
              for (let fi = 0; fi < interfaceDef.fields.length; fi++) {
                const fieldRaw = interfaceDef.fields[fi];
                if (!fieldRaw) continue;
                const field = fieldRaw as { name: string; type: string };
                if (!field.name || !field.type) continue;
                keys.push(stripOptional(field.name));
                types.push(this.convertTsType(field.type));
                tsTypes.push(field.type);
              }
              this.ctx.defineVariableWithMetadata(
                stmt.name,
                allocaReg,
                "i8*",
                SymbolKind.Object,
                "local",
                createObjectMetadataWithInterface({ keys, types, tsTypes }, baseType),
              );
              this.ctx.emit(`${allocaReg} = alloca i8*`);
              this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
              return;
            }
          }
          this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.Object, "local");
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else if (this.isUnionOfInterfaceTypes(baseType)) {
          this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.Object, "local");
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else if (this.isStringLiteralUnion(baseType)) {
          this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.String, "local");
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else {
          this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind.Number, "local");
          this.ctx.emit(`${allocaReg} = alloca double`);
          this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        }
      }
      return;
    }

    const stmtValue = stmt.value!;

    if (stmt.declaredType) {
      const strippedType = stripNullable(stmt.declaredType);
      if (strippedType === "string[]") {
        this.ctx.setExpectedArrayElementType("string");
      } else if (strippedType === "number[]" || strippedType === "boolean[]") {
        this.ctx.setExpectedArrayElementType("number");
      } else if (strippedType.endsWith("[]")) {
        this.ctx.setExpectedArrayElementType("pointer");
      }
    }

    const stmtDeclaredType: string = stmt.declaredType || "";
    const strippedDeclType = stripNullable(stmtDeclaredType);
    const resolved = this.ctx.resolveExpressionType(stmtValue);
    const nodeType = (stmtValue as ExprBase).type;

    let isString: boolean;
    let isStringArray: boolean;
    let isObjectArray: boolean;
    let isArray: boolean;
    let isMap: boolean;
    let isSet: boolean;
    let isRegex: boolean;
    let isPromise: boolean;
    let isClassInstance: boolean;
    let isUint8Array: boolean;
    let isResponse: boolean;
    let isObject: boolean;

    if (resolved) {
      const base = resolved.base;
      const depth = resolved.arrayDepth;
      isString = base === "string" && depth === 0;
      isStringArray = base === "string" && depth > 0;
      isObjectArray = depth > 0 && base !== "string" && base !== "number" && base !== "boolean";
      isArray = depth > 0 && (base === "number" || base === "boolean");
      isMap = base === "Map" || base.startsWith("Map<");
      isSet = base === "Set" || base.startsWith("Set<");
      isRegex = base === "RegExp";
      isPromise = base === "Promise";
      isUint8Array = base === "Uint8Array" && depth === 0;
      isResponse = base === "Response";
      isObject = base === "object" && depth === 0;
      isClassInstance =
        !isPromise &&
        !isRegex &&
        depth === 0 &&
        base !== "string" &&
        base !== "number" &&
        base !== "boolean" &&
        base !== "void" &&
        base !== "null" &&
        base !== "unknown" &&
        base !== "object" &&
        base !== "Response" &&
        !base.startsWith("Map") &&
        !base.startsWith("Set") &&
        this.isKnownClass(base);
    } else {
      isString = false;
      isStringArray = false;
      isObjectArray = false;
      isArray = false;
      isMap = false;
      isSet = false;
      isRegex = false;
      isPromise = false;
      isUint8Array = false;
      isClassInstance = false;
      isResponse = false;
      isObject = false;
    }

    if (!isStringArray && strippedDeclType === "string[]") {
      isStringArray = true;
    }
    if (
      !isObjectArray &&
      strippedDeclType &&
      strippedDeclType.endsWith("[]") &&
      strippedDeclType !== "string[]" &&
      strippedDeclType !== "number[]" &&
      strippedDeclType !== "boolean[]"
    ) {
      isObjectArray = true;
    }
    if (!isMap && stmtDeclaredType.startsWith("Map<")) {
      isMap = true;
    }
    if (!isSet && (stmtDeclaredType === "Set" || stmtDeclaredType.startsWith("Set<"))) {
      isSet = true;
    }
    if (!isUint8Array && strippedDeclType === "Uint8Array") {
      isUint8Array = true;
    }

    const isJSONObject = this.ctx.isJSONParseExpression(stmtValue);
    if (isObject && isJSONObject) {
      isObject = false;
    }
    const isAwait = nodeType === "await";
    const typedJsonInterface = this.ctx.getTypedJsonInterface(stmtValue);
    const functionInterfaceReturn = this.ctx.getFunctionCallInterfaceReturn(stmtValue);
    const methodInterfaceReturn = this.ctx.getMethodCallInterfaceReturn(stmtValue);
    const methodArrayReturn = this.ctx.getMethodCallArrayReturn(stmtValue);
    const memberAccessInterfaceType = this.getMemberAccessInterfaceType(stmtValue);
    const mapGetInterfaceType = this.getMapGetInterfaceType(stmtValue);
    const declaredInterfaceType = this.getDeclaredInterfaceType(stmt);
    const isArrowFunction = stmt.value && stmt.value.type === "arrow_function";
    const indexedObjectType = this.getIndexedObjectArrayType(stmt.value);
    const arrayMethodReturnType = this.getArrayMethodReturnType(stmt.value);
    const isPointer = this.isPointerOrExpression(stmt.value);
    const isNull = this.isNullLiteral(stmt.value);

    const classification = this.classifyVariable(
      isString,
      isStringArray,
      isObjectArray,
      isArray,
      isMap,
      isSet,
      isRegex,
      isPromise,
      isClassInstance,
      isUint8Array,
      isResponse,
      isObject,
      isJSONObject,
      isAwait,
      isArrowFunction ? true : false,
      isPointer,
      isNull,
      declaredInterfaceType,
      mapGetInterfaceType,
      functionInterfaceReturn,
      methodInterfaceReturn,
      methodArrayReturn,
      memberAccessInterfaceType,
      typedJsonInterface,
      indexedObjectType,
      arrayMethodReturnType,
    );

    switch (classification.kind) {
      case VarKind.DeclaredInterface:
        this.allocateDeclaredInterface(stmt, params, classification.declaredInterfaceType!);
        break;
      case VarKind.StringArray:
        this.allocateStringArray(stmt, params);
        break;
      case VarKind.MapGetInterface:
        this.allocateMapGetInterface(stmt, params, classification.mapGetInterfaceType!);
        break;
      case VarKind.FunctionInterfaceReturn:
        this.allocateFunctionInterfaceReturn(stmt, params, classification.functionInterfaceReturn!);
        break;
      case VarKind.MethodInterfaceReturn:
        this.allocateMethodInterfaceReturn(stmt, params, classification.methodInterfaceReturn!);
        break;
      case VarKind.MethodArrayReturn:
        this.allocateMethodArrayReturn(stmt, params, classification.methodArrayReturn!);
        break;
      case VarKind.MemberAccessInterface:
        this.allocateMemberAccessInterface(stmt, params, classification.memberAccessInterfaceType!);
        break;
      case VarKind.Await:
        this.allocateAwaitResult(stmt, params);
        break;
      case VarKind.Promise:
        this.allocatePromise(stmt, params);
        break;
      case VarKind.Uint8Array:
        this.allocateUint8Array(stmt, params);
        break;
      case VarKind.ClassInstance:
        this.allocateClassInstance(stmt, params);
        break;
      case VarKind.TypedJsonInterface:
        this.allocateTypedJsonInterface(stmt, params, classification.typedJsonInterface!);
        break;
      case VarKind.Response:
        this.allocateResponse(stmt, params);
        break;
      case VarKind.JSONObject:
        this.allocateJSONObject(stmt, params);
        break;
      case VarKind.Object:
        this.allocateObject(stmt, params);
        break;
      case VarKind.Map:
        this.allocateMap(stmt, params);
        break;
      case VarKind.Set:
        this.allocateSet(stmt, params);
        break;
      case VarKind.ObjectArray:
        this.allocateObjectArray(stmt, params);
        break;
      case VarKind.Array:
        this.allocateArray(stmt, params);
        break;
      case VarKind.Regex:
        this.allocateRegex(stmt, params);
        break;
      case VarKind.String:
        this.allocateString(stmt, params);
        break;
      case VarKind.ArrowFunction:
        this.allocateArrowFunction(stmt, params);
        break;
      case VarKind.IndexedObjectArray:
        this.allocateIndexedObjectArray(stmt, params, classification.indexedObjectType!);
        break;
      case VarKind.ArrayMethodReturn:
        this.allocateArrayMethodReturn(stmt, params, classification.arrayMethodReturnType!);
        break;
      case VarKind.Pointer:
        this.allocatePointer(stmt, params);
        break;
      case VarKind.Null:
        this.allocateNullPointer(stmt);
        break;
      case VarKind.Numeric:
        this.allocateNumeric(stmt, params);
        break;
    }

    if (resolved && !stmt.declaredType && !isNull) {
      this.ctx.symbolTable.setResolvedType(stmt.name, resolved);
    }

    this.ctx.setExpectedArrayElementType(null);
  }

  private allocateFunctionInterfaceReturn(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    if (interfaceName.startsWith("{")) {
      const inlineFields = this.parseInlineObjectType(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.convertTsType(field.type));
          tsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.getInterface(interfaceName);
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.convertTsType(field.type));
        tsTypes.push(field.type);
      }
    }

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private allocateMethodInterfaceReturn(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    if (interfaceName.startsWith("{")) {
      const inlineFields = this.parseInlineObjectType(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.convertTsType(field.type));
          tsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.getInterface(interfaceName);
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.convertTsType(field.type));
        tsTypes.push(field.type);
      }
    }

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private allocateMethodArrayReturn(
    stmt: VariableDeclaration,
    params: string[],
    elementType: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const elementKeys: string[] = [];
    const elementTypes: string[] = [];
    const elementTsTypes: string[] = [];

    if (elementType.startsWith("{") && elementType.endsWith("}")) {
      const inlineFields = this.parseInlineObjectType(elementType);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          elementKeys.push(stripOptional(field.name));
          elementTypes.push(this.convertTsType(field.type));
          elementTsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.getInterface(elementType);
      if (interfaceDefResult) {
        const interfaceDef = interfaceDefResult as InterfaceDeclaration;
        for (let i = 0; i < interfaceDef.fields.length; i++) {
          const field = interfaceDef.fields[i] as { name: string; type: string };
          elementKeys.push(stripOptional(field.name));
          elementTypes.push(this.convertTsType(field.type));
          elementTsTypes.push(field.type);
        }
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, "%ObjectArray*", SymbolKind.ObjectArray, "local");
    this.ctx.symbolTable.setRawInterfaceType(
      stmt.name,
      elementType.startsWith("{") ? "inline" : elementType,
    );
    this.ctx.symbolTable.setObjectArrayMetadata(stmt.name, {
      elementInterfaceName: elementType.startsWith("{") ? "inline" : elementType,
      elementKeys,
      elementTypes,
      elementTsTypes,
    });
    this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
    const arrPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %ObjectArray* ${arrPtr}, %ObjectArray** ${allocaReg}`);
  }

  private getDeclaredInterfaceType(stmt: VariableDeclaration): string | null {
    if (stmt.value && stmt.value.type === "type_assertion") {
      const assertionNode = stmt.value as TypeAssertionNode;
      const assertedType = assertionNode.assertedType;
      if (assertedType.startsWith("{")) {
        const innerType = assertedType.slice(1).trim();
        if (innerType.startsWith("[")) return null;
        return assertedType;
      }
      const interfaceDefResult = this.getInterface(assertedType);
      if (interfaceDefResult) {
        return assertedType;
      }
    }
    if (!stmt.declaredType) return null;
    const strippedDeclaredType = stripNullable(stmt.declaredType);
    if (strippedDeclaredType.startsWith("{") && stmt.value && stmt.value.type === "object") {
      const innerType = strippedDeclaredType.slice(1).trim();
      if (innerType.startsWith("[")) return null;
      return strippedDeclaredType;
    }
    if (!stmt.value || (stmt.value.type !== "variable" && stmt.value.type !== "object"))
      return null;
    const interfaceDefResult2 = this.getInterface(stmt.declaredType);
    if (!interfaceDefResult2) return null;
    return stmt.declaredType;
  }

  private parseInlineObjectType(typeStr: string): InterfaceField[] | null {
    if (!typeStr.startsWith("{") || !typeStr.endsWith("}")) {
      return null;
    }
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) {
      return [];
    }
    const fields: InterfaceField[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "{" || ch === "(" || ch === "[" || ch === "<") {
        depth++;
      } else if (ch === "}" || ch === ")" || ch === "]" || ch === ">") {
        depth--;
      } else if (ch === ";" && depth === 0) {
        const part = inner.slice(start, i).trim();
        if (part) {
          const colonIdx = part.indexOf(":");
          if (colonIdx !== -1) {
            const name = part.slice(0, colonIdx).trim();
            const fieldType = part.slice(colonIdx + 1).trim();
            fields.push({ name, type: fieldType });
          }
        }
        start = i + 1;
      }
    }
    const lastPart = inner.slice(start).trim();
    if (lastPart) {
      const colonIdx = lastPart.indexOf(":");
      if (colonIdx !== -1) {
        const name = lastPart.slice(0, colonIdx).trim();
        const fieldType = lastPart.slice(colonIdx + 1).trim();
        fields.push({ name, type: fieldType });
      }
    }
    return fields;
  }

  private allocateDeclaredInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    if (interfaceName.startsWith("{")) {
      const inlineFields = this.parseInlineObjectType(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.convertTsType(field.type));
          tsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.getInterface(interfaceName);
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const allFields = this.getAllInterfaceFields(interfaceDef);
      for (let i = 0; i < allFields.length; i++) {
        const field = allFields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.convertTsType(field.type));
        tsTypes.push(field.type);
      }
    }

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    this.ctx.setCurrentDeclaredInterfaceType(interfaceName);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredInterfaceType(undefined);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private getMapGetInterfaceType(expr: Expression): string | null {
    const result = this.ctx.typeResolver?.getMapGetInterfaceType(expr);
    if (result) {
      return result;
    }
    if (!expr || expr.type !== "method_call") return null;
    const methodExpr = expr as MethodCallNode;
    if (methodExpr.method !== "get") return null;

    let valueType: string | null = null;

    if (methodExpr.object && methodExpr.object.type === "variable") {
      const varObj = methodExpr.object as VariableNode;
      const mapName = varObj.name;
      if (!this.ctx.symbolTable.isMap(mapName)) return null;

      const mapMeta = this.ctx.symbolTable.getMapMetadata(mapName);
      if (!mapMeta) return null;
      if (mapMeta.keyType !== "string") return null;

      valueType = mapMeta.valueType;
    } else if (methodExpr.object && methodExpr.object.type === "member_access") {
      const memberExpr = methodExpr.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (memberExprObjBase.type !== "this") return null;
      if (!this.ctx.getCurrentClassName()) return null;

      const fieldInfoResult = this.ctx.classGenGetFieldInfo(
        this.ctx.getCurrentClassName()!,
        memberExpr.property,
      );
      if (!fieldInfoResult) return null;
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (!fieldInfo.tsType) return null;

      const mapParsed = parseMapTypeString(fieldInfo.tsType);
      if (!mapParsed) return null;
      if (mapParsed.keyType !== "string") return null;

      valueType = mapParsed.valueType;
    }

    if (!valueType) return null;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") return null;

    if (valueType.endsWith("[]")) {
      return valueType;
    }

    const interfaceDefResult = this.getInterface(valueType);
    if (!interfaceDefResult) return null;

    return valueType;
  }

  private allocateMapGetInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    if (interfaceName.endsWith("[]")) {
      this.allocateMapGetArray(stmt, params, interfaceName);
      return;
    }
    const interfaceDefResult = this.getInterface(interfaceName);
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < interfaceDef.fields.length; i++) {
      const field = interfaceDef.fields[i] as { name: string; type: string };
      keys.push(stripOptional(field.name));
      types.push(this.convertTsType(field.type));
      tsTypes.push(field.type);
    }
    const llvmType = `%${interfaceName}*`;
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      llvmType,
      SymbolKind.Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca ${llvmType}`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${llvmType}`);
    this.ctx.emit(`store ${llvmType} ${typedPtr}, ${llvmType}* ${allocaReg}`);
  }

  private allocateMapGetArray(
    stmt: VariableDeclaration,
    params: string[],
    arrayType: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const elementType = arrayType.slice(0, -2);
    if (elementType === "string") {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.StringArray, "local");
    } else if (elementType === "number" || elementType === "boolean") {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.Array, "local");
    } else {
      const typeInfo = this.getTypeInfoForElementType(elementType);
      if (typeInfo) {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "i8*",
          SymbolKind.ObjectArray,
          "local",
          createObjectMetadataWithInterface(
            { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes },
            elementType,
          ),
        );
      } else {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "i8*",
          SymbolKind.ObjectArray,
          "local",
          createInterfacePointerAllocaMetadata(elementType),
        );
      }
    }
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private getMemberAccessInterfaceType(expr: Expression | null): string | null {
    if (!expr) return null;
    const exprBase = expr as ExprBase;
    if (exprBase.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;
    const objBase = memberExpr.object as ExprBase;
    if (objBase.type !== "variable") return null;
    const varName = (memberExpr.object as VariableNode).name;
    if (!varName) return null;
    let objectInterfaceType: string | null = null;
    const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
    if (ifaceType) {
      objectInterfaceType = ifaceType;
    } else {
      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta && objMeta.tsTypes) {
        if (!objMeta.keys || !memberExpr.property) return null;
        const keyIdx = objMeta.keys.indexOf(memberExpr.property);
        if (keyIdx >= 0 && objMeta.tsTypes) {
          const propType = objMeta.tsTypes[keyIdx];
          if (
            propType &&
            !propType.endsWith("[]") &&
            propType !== "string" &&
            propType !== "number" &&
            propType !== "boolean"
          ) {
            const iface = this.getInterface(propType);
            if (iface) return propType;
          }
        }
        return null;
      }
    }
    if (!objectInterfaceType) return null;
    const objectInterface = this.getInterface(objectInterfaceType);
    if (!objectInterface) return null;
    const objIface = objectInterface as InterfaceDeclaration;
    if (!objIface.fields) return null;
    for (let i = 0; i < objIface.fields.length; i++) {
      const field = objIface.fields[i] as { name: string; type: string };
      if (!field || !field.name) continue;
      const fieldName = stripOptional(field.name);
      if (fieldName === memberExpr.property) {
        const fieldType = field.type;
        if (
          fieldType &&
          !fieldType.endsWith("[]") &&
          fieldType !== "string" &&
          fieldType !== "number" &&
          fieldType !== "boolean"
        ) {
          const nestedIface = this.getInterface(fieldType);
          if (nestedIface) return fieldType;
        }
        return null;
      }
    }
    return null;
  }

  private allocateMemberAccessInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    const interfaceDefResult = this.getInterface(interfaceName);
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < interfaceDef.fields.length; i++) {
      const field = interfaceDef.fields[i] as { name: string; type: string };
      keys.push(stripOptional(field.name));
      types.push(this.convertTsType(field.type));
      tsTypes.push(field.type);
    }
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private allocateClassInstance(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    let className: string;

    const valueBase = stmt.value as ExprBase;
    if (valueBase.type === "new") {
      const newExpr = stmt.value as NewNode;
      className = newExpr.className;
    } else if (valueBase.type === "method_call") {
      const methodExpr = stmt.value as MethodCallNode;
      className = this.getMapGetClassName(methodExpr) || "Unknown";
    } else {
      throw new Error(`Cannot allocate class instance for expression type: ${valueBase.type}`);
    }

    const fields = this.ctx.classGenGetClassFields(className);
    const ptrType = fields.length > 0 ? `%${className}_struct*` : "i8*";

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      ptrType,
      SymbolKind.Class,
      "local",
      createClassMetadata({ className }),
    );
    this.ctx.emit(`${allocaReg} = alloca ${ptrType}`);

    const instancePtr = this.ctx.generateExpression(stmt.value!, params);
    if (fields.length > 0) {
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${instancePtr} to ${ptrType}`);
      this.ctx.emit(`store ${ptrType} ${typedPtr}, ${ptrType}* ${allocaReg}`);
    } else {
      this.ctx.emit(`store ${ptrType} ${instancePtr}, ${ptrType}* ${allocaReg}`);
    }
  }

  private getMapGetClassName(methodExpr: MethodCallNode): string | null {
    if (methodExpr.method !== "get") return null;
    const methodObjBase = methodExpr.object as ExprBase;
    if (methodObjBase.type === "variable") {
      const varName = (methodExpr.object as VariableNode).name;
      if (this.ctx.symbolTable.isMap(varName)) {
        const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
        if (mapMeta && mapMeta.valueType) {
          return mapMeta.valueType;
        }
      }
    } else if (methodObjBase.type === "member_access") {
      const memberExpr = methodExpr.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (
        memberExprObjBase.type === "this" &&
        this.ctx.getCurrentClassName() &&
        this.ctx.hasClassGen()
      ) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(
          this.ctx.getCurrentClassName()!,
          memberExpr.property,
        );
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType) {
          const mapParsed = parseMapTypeString(fieldInfo.tsType);
          if (mapParsed && mapParsed.valueType) {
            return mapParsed.valueType;
          }
        }
      }
    }
    return null;
  }

  private allocatePromise(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Promise*", SymbolKind.Object, "local");
    this.ctx.emit(`${allocaReg} = alloca %Promise*`);

    const promisePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %Promise* ${promisePtr}, %Promise** ${allocaReg}`);
  }

  private allocateAwaitResult(stmt: VariableDeclaration, params: string[]): void {
    const awaitExpr = stmt.value as AwaitExpressionNode;
    const inner = awaitExpr.argument as ExprBase;

    if (inner.type === "method_call") {
      const methodCall = awaitExpr.argument as MethodCallNode;
      const objBase = methodCall.object as ExprBase;
      if (
        objBase.type === "variable" &&
        (methodCall.object as VariableNode).name === "Promise" &&
        methodCall.method === "all"
      ) {
        const allocaReg = this.ctx.nextAllocaReg(stmt.name);
        this.ctx.defineVariable(
          stmt.name,
          allocaReg,
          "%ObjectArray*",
          SymbolKind.ObjectArray,
          "local",
        );
        this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        const castReg = this.ctx.nextTemp();
        this.ctx.emit(`${castReg} = bitcast i8* ${value} to %ObjectArray*`);
        this.ctx.emit(`store %ObjectArray* ${castReg}, %ObjectArray** ${allocaReg}`);
        return;
      }
      if (
        objBase.type === "variable" &&
        (methodCall.object as VariableNode).name === "fs" &&
        methodCall.method === "readdir"
      ) {
        const allocaReg = this.ctx.nextAllocaReg(stmt.name);
        this.ctx.defineVariable(
          stmt.name,
          allocaReg,
          "%StringArray*",
          SymbolKind.StringArray,
          "local",
        );
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        const castReg = this.ctx.nextTemp();
        this.ctx.emit(`${castReg} = bitcast i8* ${value} to %StringArray*`);
        this.ctx.emit(`store %StringArray* ${castReg}, %StringArray** ${allocaReg}`);
        return;
      }
      if (
        objBase.type === "variable" &&
        (methodCall.object as VariableNode).name === "fs" &&
        methodCall.method === "stat"
      ) {
        const allocaReg = this.ctx.nextAllocaReg(stmt.name);
        this.ctx.defineVariable(stmt.name, allocaReg, "%StatResult*", SymbolKind.Object, "local");
        this.ctx.emit(`${allocaReg} = alloca %StatResult*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        const castReg = this.ctx.nextTemp();
        this.ctx.emit(`${castReg} = bitcast i8* ${value} to %StatResult*`);
        this.ctx.emit(`store %StatResult* ${castReg}, %StatResult** ${allocaReg}`);
        return;
      }
    }

    if (inner.type === "call") {
      const callNode = awaitExpr.argument as CallNode;
      if (callNode.name === "fetch") {
        const allocaReg = this.ctx.nextAllocaReg(stmt.name);
        this.ctx.defineVariable(
          stmt.name,
          allocaReg,
          "%__FetchResponse*",
          SymbolKind.Object,
          "local",
        );
        this.ctx.emit(`${allocaReg} = alloca %__FetchResponse*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store %__FetchResponse* ${value}, %__FetchResponse** ${allocaReg}`);
        return;
      }
    }

    if (stmt.declaredType === "Response") {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(
        stmt.name,
        allocaReg,
        "%__FetchResponse*",
        SymbolKind.Object,
        "local",
      );
      this.ctx.emit(`${allocaReg} = alloca %__FetchResponse*`);
      const value = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store %__FetchResponse* ${value}, %__FetchResponse** ${allocaReg}`);
      return;
    }

    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.String, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateTypedJsonInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const structType = `%${interfaceName}*`;
    this.ctx.defineVariable(stmt.name, allocaReg, structType, SymbolKind.Object, "local");
    this.ctx.emit(`${allocaReg} = alloca ${structType}`);

    const structPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store ${structType} ${structPtr}, ${structType}* ${allocaReg}`);
  }

  private allocateResponse(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%__FetchResponse*", SymbolKind.Object, "local");
    this.ctx.emit(`${allocaReg} = alloca %__FetchResponse*`);

    const responsePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %__FetchResponse* ${responsePtr}, %__FetchResponse** ${allocaReg}`);
  }

  private allocateJSONObject(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const interfaceName = this.ctx.getJSONParseInterface(stmt.value!);
    if (!interfaceName) {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.JSON, "local");
      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
      return;
    }

    if (interfaceName === "number[]") {
      this.ctx.defineVariable(stmt.name, allocaReg, "%Array*", SymbolKind.Array, "local");
      this.ctx.emit(`${allocaReg} = alloca %Array*`);
      const arrPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store %Array* ${arrPtr}, %Array** ${allocaReg}`);
      return;
    }

    const interfaceDefResult = this.getInterface(interfaceName);

    if (!interfaceDefResult) {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.JSON, "local");
      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
    } else {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        tsTypes.push(field.type);
        types.push(this.convertTsTypeJson(field.type));
      }

      this.ctx.defineVariableWithMetadata(
        stmt.name,
        allocaReg,
        "i8*",
        SymbolKind.JSON,
        "local",
        createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
      );

      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
    }
  }

  private allocateObject(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const interfaceDefResult = stmt.declaredType ? this.getInterface(stmt.declaredType) : null;

    let keys: string[];
    let types: string[];
    let tsTypes: string[] | undefined;

    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      keys = [];
      types = [];
      tsTypes = [];
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.convertTsType(field.type));
        tsTypes.push(field.type);
      }
    } else {
      const metadataResult = this.ctx.getObjectMetadata(stmt.value as ObjectNode);
      const metadata = metadataResult as ObjectMetadataResult;
      keys = metadata ? metadata.keys : [];
      types = metadata ? metadata.types : [];
    }

    const varMetadata: SymbolMetadata =
      interfaceDefResult && stmt.declaredType
        ? createObjectMetadataWithInterface({ keys, types, tsTypes }, stmt.declaredType)
        : createObjectMetadata({ keys, types, tsTypes });
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      varMetadata,
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    if (interfaceDefResult) {
      this.ctx.setCurrentDeclaredInterfaceType(stmt.declaredType);
    }
    const objExpr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredInterfaceType(undefined);
    this.ctx.emit(`store i8* ${objExpr}, i8** ${allocaReg}`);
  }

  private allocateMap(stmt: VariableDeclaration, params: string[]): void {
    let mapTypeInfoResult = this.parseMapType(stmt.declaredType);

    if (!mapTypeInfoResult && stmt.value && stmt.value.type === "map") {
      const mapNode = stmt.value as MapNode;
      if (mapNode.keyType && mapNode.valueType) {
        mapTypeInfoResult = { keyType: mapNode.keyType, valueType: mapNode.valueType };
      }
    }

    if (
      !mapTypeInfoResult &&
      stmt.value &&
      stmt.value.type !== "new" &&
      stmt.value.type !== "map"
    ) {
      const resolved = this.ctx.resolveExpressionType(stmt.value);
      if (resolved && resolved.base.startsWith("Map<")) {
        mapTypeInfoResult = this.parseMapType(resolved.base);
      }
    }

    if (mapTypeInfoResult) {
      const mapTypeInfo = mapTypeInfoResult as MapTypeInfo;
      if (mapTypeInfo.keyType === "string") {
        this.allocateStringMap(stmt, params, mapTypeInfo);
        return;
      }
    }
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Map*", SymbolKind.Map, "local");
    this.ctx.emit(`${allocaReg} = alloca %Map`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %Map, %Map* ${value}`);
    this.ctx.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
  }

  private allocateStringMap(
    stmt: VariableDeclaration,
    params: string[],
    mapTypeInfo: MapTypeInfo,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const llvmValueType = this.convertTsType(mapTypeInfo.valueType);

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%StringMap*",
      SymbolKind.Map,
      "local",
      createMapMetadataSymbol({
        keyType: "string",
        valueType: mapTypeInfo.valueType,
        llvmKeyType: "i8*",
        llvmValueType,
      }),
    );
    this.ctx.emit(`${allocaReg} = alloca %StringMap`);

    const declaredMapType =
      stmt.declaredType || `Map<${mapTypeInfo.keyType}, ${mapTypeInfo.valueType}>`;
    this.ctx.setCurrentDeclaredMapType(declaredMapType);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredMapType(undefined);

    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %StringMap, %StringMap* ${value}`);
    this.ctx.emit(`store %StringMap ${loadedMap}, %StringMap* ${allocaReg}`);
  }

  private parseMapType(declaredType: string | undefined): MapTypeInfo | null {
    if (!declaredType) return null;

    const parsed = parseMapTypeString(declaredType);
    if (!parsed) return null;

    return {
      keyType: parsed.keyType,
      valueType: parsed.valueType,
    };
  }

  private parseSetType(declaredType: string | undefined): SetTypeInfo | null {
    if (!declaredType) return null;

    const parsed = parseSetTypeString(declaredType);
    if (!parsed) return null;

    return {
      valueType: parsed.valueType,
    };
  }

  private allocateSet(stmt: VariableDeclaration, params: string[]): void {
    let setTypeInfoResult = this.parseSetType(stmt.declaredType);

    if (!setTypeInfoResult && stmt.value) {
      const valueBase = stmt.value as { type: string };
      if (valueBase.type === "new") {
        const newExpr = stmt.value as { className: string; typeArgs?: string[] };
        if (newExpr.className === "Set" && newExpr.typeArgs && newExpr.typeArgs.length > 0) {
          setTypeInfoResult = { valueType: newExpr.typeArgs[0] };
        }
      } else if (valueBase.type === "set") {
        const setExpr = stmt.value as { valueType?: string };
        if (setExpr.valueType) {
          setTypeInfoResult = { valueType: setExpr.valueType };
        }
      }
    }

    if (
      !setTypeInfoResult &&
      stmt.value &&
      stmt.value.type !== "new" &&
      stmt.value.type !== "set"
    ) {
      const resolved = this.ctx.resolveExpressionType(stmt.value);
      if (resolved && resolved.base.startsWith("Set<")) {
        setTypeInfoResult = this.parseSetType(resolved.base);
      }
    }

    if (setTypeInfoResult) {
      const setTypeInfo = setTypeInfoResult as SetTypeInfo;
      if (setTypeInfo.valueType === "string") {
        this.allocateStringSet(stmt, params, setTypeInfo);
        return;
      }
    }
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Set*", SymbolKind.Set, "local");
    this.ctx.emit(`${allocaReg} = alloca %Set`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedSet = this.ctx.nextTemp();
    this.ctx.emit(`${loadedSet} = load %Set, %Set* ${value}`);
    this.ctx.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
  }

  private allocateStringSet(
    stmt: VariableDeclaration,
    params: string[],
    setTypeInfo: SetTypeInfo,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const llvmValueType = this.convertTsType(setTypeInfo.valueType);

    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%StringSet*",
      SymbolKind.Set,
      "local",
      createSetMetadataSymbol({
        valueType: "string",
        llvmValueType,
      }),
    );
    this.ctx.emit(`${allocaReg} = alloca %StringSet`);

    this.ctx.setCurrentDeclaredSetType(stmt.declaredType);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.setCurrentDeclaredSetType(undefined);

    const loadedSet = this.ctx.nextTemp();
    this.ctx.emit(`${loadedSet} = load %StringSet, %StringSet* ${value}`);
    this.ctx.emit(`store %StringSet ${loadedSet}, %StringSet* ${allocaReg}`);
  }

  private allocateStringArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%StringArray*",
      SymbolKind.StringArray,
      "local",
      createPointerAllocaMetadata(),
    );
    this.ctx.emit(`${allocaReg} = alloca %StringArray*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType = this.ctx.getVariableType(value);
    let pointerValue = value;
    if (valueType === "i32") {
      const ptrValue = this.ctx.nextTemp();
      this.ctx.emit(`${ptrValue} = inttoptr i32 ${value} to %StringArray*`);
      pointerValue = ptrValue;
    } else if (valueType !== "%StringArray*") {
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${pointerValue} to %StringArray*`);
      pointerValue = typedPtr;
    }
    this.ctx.emit(`store %StringArray* ${pointerValue}, %StringArray** ${allocaReg}`);
  }

  private allocateArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "%Array*",
      SymbolKind.Array,
      "local",
      createPointerAllocaMetadata(),
    );
    this.ctx.emit(`${allocaReg} = alloca %Array*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType = this.ctx.getVariableType(value);
    let pointerValue = value;
    if (valueType !== "%Array*") {
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${pointerValue} to %Array*`);
      pointerValue = typedPtr;
    }
    this.ctx.emit(`store %Array* ${pointerValue}, %Array** ${allocaReg}`);
  }

  private allocateUint8Array(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Uint8Array*", SymbolKind.Uint8Array, "local");
    this.ctx.emit(`${allocaReg} = alloca %Uint8Array*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %Uint8Array* ${value}, %Uint8Array** ${allocaReg}`);
  }

  private allocateObjectArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);

    let elementType = this.ctx.getObjectArrayElementType(stmt.value!);
    if (!elementType && stmt.declaredType && stmt.declaredType.endsWith("[]")) {
      elementType = stmt.declaredType.slice(0, -2);
    }

    if (elementType) {
      const typeInfo = this.getTypeInfoForElementType(elementType);
      if (typeInfo) {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%ObjectArray*",
          SymbolKind.ObjectArray,
          "local",
          createObjectMetadataWithInterface(
            {
              keys: typeInfo.keys,
              types: typeInfo.types,
              tsTypes: typeInfo.tsTypes,
            },
            elementType,
          ),
        );
        this.ctx.symbolTable.setRawInterfaceType(stmt.name, elementType);
        this.ctx.symbolTable.setObjectArrayMetadata(stmt.name, {
          elementInterfaceName: elementType,
          elementKeys: typeInfo.keys,
          elementTypes: typeInfo.types,
          elementTsTypes: typeInfo.tsTypes,
        });
        this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
        return;
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, "%ObjectArray*", SymbolKind.ObjectArray, "local");
    this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
  }

  private allocateRegex(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.Regex, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateString(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.String, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private isPointerOrExpression(expr: Expression | null): boolean {
    if (!expr) return false;
    const e = expr as ExprBase;
    if (e.type === "binary") {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === "||") {
        const rightBase = binExpr.right as ExprBase;
        if (rightBase.type === "array") {
          const leftBase = binExpr.left as ExprBase;
          if (leftBase.type === "member_access" || leftBase.type === "method_call") {
            return true;
          }
        }
      }
    }
    return false;
  }

  private allocatePointer(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);

    const elementType = this.getPointerExpressionElementType(stmt.value);
    if (elementType) {
      const typeInfo = this.getTypeInfoForElementType(elementType);
      if (typeInfo) {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "i8*",
          SymbolKind.ObjectArray,
          "local",
          createObjectMetadataWithInterface(
            { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes },
            elementType,
          ),
        );
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
        return;
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.JSON, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private getPointerExpressionElementType(expr: Expression | null): string | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (e.type !== "binary") return null;

    const binExpr = expr as BinaryNode;
    if (binExpr.op !== "||") return null;

    const leftBase = binExpr.left as ExprBase;
    if (leftBase.type !== "member_access" && leftBase.type !== "method_call") return null;

    return this.ctx.getObjectArrayElementType(binExpr.left);
  }

  private isNullLiteral(expr: Expression | null): boolean {
    if (!expr) return false;
    const e = expr as ExprBase;
    if (e.type === "null" || e.type === "undefined") return true;
    if (e.type === "variable") {
      const v = expr as VariableNode;
      return v.name === "null" || v.name === "undefined";
    }
    return false;
  }

  private allocateNullPointer(stmt: VariableDeclaration): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);

    if (stmt.declaredType) {
      const baseType = stripNullable(stmt.declaredType);
      if (baseType === "number") {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind.Number, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        return;
      }
      if (baseType === "boolean") {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind.Number, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        return;
      }
      if (baseType === "string") {
        this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.String, "local");
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        return;
      }
      if (baseType === "string[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%StringArray*",
          SymbolKind.StringArray,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        this.ctx.emit(`store %StringArray* null, %StringArray** ${allocaReg}`);
        return;
      }
      if (baseType === "number[]" || baseType === "boolean[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%Array*",
          SymbolKind.Array,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %Array*`);
        this.ctx.emit(`store %Array* null, %Array** ${allocaReg}`);
        return;
      }
      if (baseType.startsWith("{")) {
        const inlineFields = this.parseInlineObjectType(baseType);
        if (inlineFields && inlineFields.length > 0) {
          const keys: string[] = [];
          const types: string[] = [];
          const tsTypes: string[] = [];
          for (let fi = 0; fi < inlineFields.length; fi++) {
            const field = inlineFields[fi] as { name: string; type: string };
            keys.push(stripOptional(field.name));
            types.push(this.convertTsType(field.type));
            tsTypes.push(field.type);
          }
          this.ctx.defineVariableWithMetadata(
            stmt.name,
            allocaReg,
            "i8*",
            SymbolKind.Object,
            "local",
            createObjectMetadata({ keys, types, tsTypes }),
          );
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
          return;
        }
      }
      const interfaceDefResult = this.getInterface(baseType);
      if (interfaceDefResult) {
        const interfaceDef = interfaceDefResult as InterfaceDeclaration;
        const keys: string[] = [];
        const types: string[] = [];
        const tsTypes: string[] = [];
        for (let fi = 0; fi < interfaceDef.fields.length; fi++) {
          const field = interfaceDef.fields[fi] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.convertTsType(field.type));
          tsTypes.push(field.type);
        }
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "i8*",
          SymbolKind.Object,
          "local",
          createObjectMetadataWithInterface({ keys, types, tsTypes }, baseType),
        );
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        return;
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind.String, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
  }

  private allocateNumeric(stmt: VariableDeclaration, params: string[]): void {
    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType: string | undefined = this.ctx.getVariableType(value);

    const isTreeSitterType =
      valueType === "%TSNode*" ||
      valueType === "%TSTree*" ||
      valueType === "%TSParser*" ||
      valueType === "%TSLanguage*";
    if (isTreeSitterType) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(stmt.name, allocaReg, valueType, SymbolKind.Object, "local");
      this.ctx.emit(`${allocaReg} = alloca double`);
      this.ctx.emit(`store double ${value}, double* ${allocaReg}`);
    } else if (valueType && valueType !== "double" && valueType.indexOf("*") !== -1) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(stmt.name, allocaReg, valueType, SymbolKind.Object, "local");
      this.ctx.emit(`${allocaReg} = alloca ${valueType}`);
      this.ctx.emit(`store ${valueType} ${value}, ${valueType}* ${allocaReg}`);
    } else {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      if (valueType === "i64") {
        this.ctx.defineVariable(stmt.name, allocaReg, "i64", SymbolKind.Number, "local");
        this.ctx.emit(`${allocaReg} = alloca i64`);
        this.ctx.emit(`store i64 ${value}, i64* ${allocaReg}`);
      } else {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind.Number, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        if (valueType === "i32") {
          const converted = this.ctx.nextTemp();
          this.ctx.emit(`${converted} = sitofp i32 ${value} to double`);
          this.ctx.emit(`store double ${converted}, double* ${allocaReg}`);
        } else if (valueType === "i64") {
          const converted = this.ctx.nextTemp();
          this.ctx.emit(`${converted} = sitofp i64 ${value} to double`);
          this.ctx.emit(`store double ${converted}, double* ${allocaReg}`);
        } else {
          this.ctx.emit(`store double ${value}, double* ${allocaReg}`);
        }
      }
    }
  }

  private allocateArrowFunction(stmt: VariableDeclaration, params: string[]): void {
    if (!stmt.value) return;
    const scopeVarsResult = this.ctx.symbolTable.getScopeVarsArraysForClosure();
    const scopeVarsTyped = scopeVarsResult as { names: string[]; types: string[] };
    const lambdaName = this.ctx.arrowFunctionGen.generateArrowFunction(
      stmt.value,
      params,
      undefined,
      scopeVarsTyped.names,
      scopeVarsTyped.types,
    );

    const closureInfoResult = this.ctx.arrowFunctionGen.getClosureInfoForLambda(lambdaName);
    const closureInfo = closureInfoResult as ClosureInfoResult;

    if (closureInfoResult && closureInfo.captures.length > 0) {
      const captures = closureInfo.captures as CaptureInfo[];
      const structSize = captures.length * 8;
      const envMemReg = this.ctx.nextTemp();
      this.ctx.emit(`${envMemReg} = call i8* @GC_malloc(i64 ${structSize})`);

      const envTypedReg = this.ctx.nextTemp();
      this.ctx.emit(`${envTypedReg} = bitcast i8* ${envMemReg} to ${closureInfo.envStructName}*`);

      for (let i = 0; i < captures.length; i++) {
        const captureItem = captures[i] as CaptureInfo;
        const allocaReg = this.ctx.symbolTable.getAlloca(captureItem.name);
        if (!allocaReg) {
          throw new Error(`Closure capture error: variable '${captureItem.name}' not found`);
        }

        const valueReg = this.ctx.nextTemp();
        this.ctx.emit(
          `${valueReg} = load ${captureItem.llvmType}, ${captureItem.llvmType}* ${allocaReg}`,
        );

        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(
          `${fieldPtr} = getelementptr ${closureInfo.envStructName}, ${closureInfo.envStructName}* ${envTypedReg}, i32 0, i32 ${i}`,
        );

        this.ctx.emit(
          `store ${captureItem.llvmType} ${valueReg}, ${captureItem.llvmType}* ${fieldPtr}`,
        );
      }

      this.ctx.defineVariableWithMetadata(
        stmt.name,
        envTypedReg,
        "i8*",
        SymbolKind.Closure,
        "local",
        createClosureMetadataSymbol({
          lambdaName,
          envStructName: closureInfo.envStructName,
          envPtrRegister: envMemReg,
          captures: captures,
        }),
      );
    } else {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariableWithMetadata(
        stmt.name,
        allocaReg,
        "i8*",
        SymbolKind.Closure,
        "local",
        createClosureMetadataSymbol({
          lambdaName,
          envStructName: "",
          envPtrRegister: "null",
          captures: [],
        }),
      );
    }
  }

  private getIndexedObjectArrayType(
    expr: Expression | null,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (e.type !== "index_access") return null;

    const indexExpr = expr as IndexAccessNode;
    if (!indexExpr.object) return null;
    const idxObjBase = indexExpr.object as ExprBase;
    if (!idxObjBase || !idxObjBase.type) return null;

    if (idxObjBase.type === "variable") {
      const varName = (indexExpr.object as VariableNode).name;
      if (!varName) return null;
      const ifaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (ifaceType) {
        return this.getTypeInfoForElementType(ifaceType);
      }
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return {
          keys: objArrayMeta.elementKeys,
          types: objArrayMeta.elementTypes,
          tsTypes: objArrayMeta.elementTsTypes || [],
        };
      }
      const objArrElemType = this.ctx.symbolTable.getRawInterfaceType(varName);
      if (objArrElemType) {
        return this.getTypeInfoForElementType(objArrElemType);
      }
      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta && objMeta.tsTypes) {
        const tsTypes = objMeta.tsTypes as string[];
        if (tsTypes.length > 0) {
          const firstType = tsTypes[0];
          if (firstType && firstType.endsWith("[]")) {
            const elementType = firstType.slice(0, -2);
            return this.getTypeInfoForElementType(elementType);
          }
          return {
            keys: objMeta.keys as string[],
            types: objMeta.types as string[],
            tsTypes: tsTypes,
          };
        }
      }
      const objectMeta2 = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objectMeta2 && objectMeta2.keys && objectMeta2.types && objectMeta2.tsTypes) {
        return {
          keys: objectMeta2.keys as string[],
          types: objectMeta2.types as string[],
          tsTypes: objectMeta2.tsTypes as string[],
        };
      }
      return null;
    }

    if (idxObjBase.type === "method_call") {
      const methodCall = indexExpr.object as MethodCallNode;
      const returnType = this.getMethodCallReturnType(methodCall);
      if (returnType && returnType.endsWith("[]")) {
        const elementType = returnType.slice(0, -2).trim();
        return this.getTypeInfoForElementType(elementType);
      }
      return null;
    }

    if (idxObjBase.type !== "member_access") return null;

    const memberAccess = indexExpr.object as { type: string; object: Expression; property: string };
    if (!memberAccess || !memberAccess.object || !memberAccess.property) return null;
    const propertyName = memberAccess.property;

    const memberObjBase = memberAccess.object as ExprBase;
    if (!memberObjBase || !memberObjBase.type) return null;
    if (memberObjBase.type === "variable") {
      const varName = (memberAccess.object as VariableNode).name;
      if (!varName) return null;
      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (!objMeta) return null;
      if (!objMeta.keys) return null;

      const propIndex = objMeta.keys.indexOf(propertyName);
      if (propIndex === -1) return null;

      const objMetaTsTypes = objMeta.tsTypes as string[];
      if (!objMetaTsTypes) return null;
      const propTsType = objMetaTsTypes[propIndex];
      if (!propTsType) return null;

      const arrayParsed = parseArrayTypeString(propTsType);
      if (!arrayParsed) return null;

      const elementType = arrayParsed.elementType;
      return this.getTypeInfoForElementType(elementType);
    }

    if (memberObjBase.type === "member_access" || memberObjBase.type === "this") {
      const memberAccessTyped = memberAccess as {
        type: string;
        object: Expression;
        property: string;
      };
      const elementType = this.resolveNestedMemberArrayType(memberAccessTyped as MemberAccessNode);
      if (elementType) {
        return this.getTypeInfoForElementType(elementType);
      }
    }

    return null;
  }

  private resolveNestedMemberArrayType(memberAccess: MemberAccessNode): string | null {
    const ma = memberAccess as { type: string; object: Expression; property: string };
    const objectType = this.resolveMemberAccessObjectType(ma.object);
    if (!objectType) return null;

    const fieldType = this.getInterfaceFieldTypeByName(objectType, ma.property);
    if (!fieldType) return null;

    const arrayParsed = parseArrayTypeString(fieldType);
    if (!arrayParsed) return null;

    return arrayParsed.elementType;
  }

  private resolveMemberAccessObjectType(expr: Expression): string | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (!e.type) return null;
    if (e.type === "this") {
      return this.ctx.getCurrentClassName() || null;
    }
    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
      if (objMeta && objMeta.tsTypes) {
        return this.ctx.symbolTable.getType(varName) || null;
      }
      return null;
    }
    if (e.type === "member_access") {
      const member = expr as MemberAccessNode;
      if (!member || !member.object || !member.property) return null;
      const memberObjBase = member.object as ExprBase;
      if (!memberObjBase || !memberObjBase.type) return null;
      if (memberObjBase.type === "this") {
        const fieldInfoResult = this.getThisFieldInfo(member.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType) {
          return fieldInfo.tsType;
        }
        return null;
      }
      const objectType = this.resolveMemberAccessObjectType(member.object);
      if (objectType) {
        const fieldType = this.getInterfaceFieldTypeByName(objectType, member.property);
        return fieldType;
      }
    }
    return null;
  }

  private getMethodCallReturnType(methodCall: MethodCallNode): string | null {
    const objectType = this.resolveMemberAccessObjectType(methodCall.object);
    if (!objectType) return null;

    const ast = this.ctx.getAst();
    const classes = ast ? ast.classes || [] : [];
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      if (cls.name === objectType) {
        for (let j = 0; j < cls.methods.length; j++) {
          const method = cls.methods[j];
          if (method.name === methodCall.method && method.returnType) {
            return method.returnType;
          }
        }
      }
    }

    return null;
  }

  private getInterfaceFieldTypeByName(interfaceName: string, fieldName: string): string | null {
    const ifaceResult = this.getInterface(interfaceName);
    if (!ifaceResult) return null;
    const iface = ifaceResult as InterfaceDeclaration;
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i] as { name: string; type: string };
      if (f.name === fieldName) {
        return f.type;
      }
    }
    return null;
  }

  private getThisFieldInfo(fieldName: string): { tsType?: string } | null {
    if (!this.ctx.getCurrentClassName()) return null;
    return this.ctx.classGenGetFieldInfo(this.ctx.getCurrentClassName()!, fieldName);
  }

  private getTypeInfoForElementType(
    elementType: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (elementType.startsWith("{")) {
      const inlineFields = this.parseInlineObjectType(elementType + "[]");
      if (inlineFields) {
        const keys: string[] = [];
        const types: string[] = [];
        const tsTypes: string[] = [];
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.convertTsType(field.type));
          tsTypes.push(field.type);
        }
        return { keys, types, tsTypes };
      }
    }

    const interfaceDefResult = this.getInterface(elementType);
    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const types: string[] = [];
      const tsTypes: string[] = [];
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.convertTsType(field.type));
        tsTypes.push(field.type);
      }
      return { keys, types, tsTypes };
    }

    const typeAliasRaw = this.getTypeAlias(elementType);
    if (typeAliasRaw) {
      const typeAlias = typeAliasRaw as { name: string; unionMembers: string[] };
      if (typeAlias.unionMembers) {
        const commonFieldsResult = this.getUnionCommonFields(typeAlias.unionMembers);
        const commonFields = commonFieldsResult as UnionCommonFields;
        if (commonFields.keys.length > 0) {
          return commonFields;
        }
      }
    }

    return null;
  }

  private getUnionCommonFields(memberNames: string[]): {
    keys: string[];
    types: string[];
    tsTypes: string[];
  } {
    const result = this.ctx.typeResolver?.getUnionCommonFields(memberNames);
    if (result && result.keys.length > 0) {
      return { keys: result.keys, types: result.types, tsTypes: result.types };
    }
    const interfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < memberNames.length; i++) {
      const ifaceResult = this.getInterface(memberNames[i]);
      if (ifaceResult) {
        const iface = ifaceResult as InterfaceDeclaration;
        interfaces.push(iface);
      }
    }

    if (interfaces.length === 0) {
      return { keys: [], types: [], tsTypes: [] };
    }

    const firstInterface = interfaces[0] as InterfaceDeclaration;
    const firstFields = firstInterface.fields;
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as { fields: { name: string; type: string }[] };
        let found = false;
        for (let fj = 0; fj < ifaceTyped.fields.length; fj++) {
          const f = ifaceTyped.fields[fj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            found = true;
            break;
          }
        }
        if (!found) {
          isCommon = false;
          break;
        }
      }
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < commonFields.length; i++) {
      const cf = commonFields[i] as CommonField;
      keys.push(stripOptional(cf.name));
      types.push(this.convertTsType(cf.type));
      tsTypes.push(cf.type);
    }

    return { keys, types, tsTypes };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    const result = this.ctx.typeResolverAreTypesCompatible(type1, type2);
    if (result) {
      return result;
    }
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    const result = this.ctx.typeResolverNormalizeType(type);
    if (result && result !== type) {
      return result;
    }
    if (type.startsWith("'") && type.endsWith("'")) return "string";
    if (type.startsWith('"') && type.endsWith('"')) return "string";
    return type;
  }

  private allocateIndexedObjectArray(
    stmt: VariableDeclaration,
    params: string[],
    typeInfo: UnionCommonFields,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadata({
        keys: typeInfo.keys,
        types: typeInfo.types,
        tsTypes: typeInfo.tsTypes,
      }),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private convertTsType(tsType: string): string {
    if (this.isEnumType(tsType)) {
      return "double";
    }
    return tsTypeToLlvm(tsType);
  }

  private convertTsTypeJson(tsType: string): string {
    return tsTypeToLlvmJson(tsType);
  }

  private getArrayMethodReturnType(
    expr: Expression | null,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!expr) return null;
    const result = this.ctx.typeResolverResolveArrayMethodReturnType(expr);
    if (result) {
      return { keys: result.keys, types: result.types, tsTypes: result.tsTypes || result.types };
    }
    return null;
  }

  private allocateArrayMethodReturn(
    stmt: VariableDeclaration,
    params: string[],
    typeInfo: UnionCommonFields,
  ): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind.Object,
      "local",
      createObjectMetadata({
        keys: typeInfo.keys,
        types: typeInfo.types,
        tsTypes: typeInfo.tsTypes,
      }),
    );
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }
}
