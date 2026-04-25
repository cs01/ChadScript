// Variable allocation and type classification for LLVM IR codegen.
// This file is being progressively decomposed — new functionality should go in
// separate files. See interface-allocator.ts, json-allocator.ts, etc.
//
// NOTE: This file uses raw ctx.emit() extensively. Prefer structured IR builders
// (emitStore, emitLoad, emitCall, etc.) when modifying — see .claude/rules.md.

import {
  Expression,
  NewNode,
  AST,
  VariableDeclaration,
  InterfaceDeclaration,
  InterfaceField,
  ObjectNode,
  MemberAccessNode,
  VariableNode,
  TypeAliasDeclaration,
  MethodCallNode,
  CallNode,
  ClassNode,
  FunctionNode,
  CommonField,
  BinaryNode,
  AwaitExpressionNode,
  ArrowFunctionNode,
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
  SymbolKind_Regex,
  SymbolKind_JSON,
  SymbolKind_Closure,
  SymbolKind_Uint8Array,
  SymbolTable,
  ObjectMetadata,
  createPointerAllocaMetadata,
  createObjectMetadata,
  createObjectMetadataWithInterface,
  createClosureMetadataSymbol,
  SymbolMetadata,
} from "./symbol-table.js";
import { TypeResolver, UnionCommonFields } from "./type-resolver/index.js";
import type { FieldInfo } from "./type-resolver/types.js";
import { stripOptional, stripNullable, tsTypeToLlvmJson } from "./type-system.js";
import {
  parseTypeString,
  isObjectArrayTsType,
  isAnyArrayTsType,
  type ResolvedType,
} from "./type-system.js";
import { InterfaceAllocator } from "./interface-allocator.js";
import { MapAllocator } from "./map-allocator.js";
import { ClassAllocator } from "./class-allocator.js";
import { ArrayAllocator } from "./array-allocator.js";

interface ExprBase {
  type: string;
}

const VarKind_DeclaredInterface = 0;
const VarKind_StringArray = 1;
const VarKind_MapGetInterface = 2;
const VarKind_FunctionInterfaceReturn = 3;
const VarKind_MethodInterfaceReturn = 4;
const VarKind_MethodArrayReturn = 5;
const VarKind_MemberAccessInterface = 6;
const VarKind_Await = 7;
const VarKind_Promise = 8;
const VarKind_Uint8Array = 9;
const VarKind_ClassInstance = 10;
const VarKind_TypedJsonInterface = 11;
const VarKind_Response = 12;
const VarKind_JSONObject = 13;
const VarKind_Object = 14;
const VarKind_Map = 15;
const VarKind_Set = 16;
const VarKind_ObjectArray = 17;
const VarKind_Array = 18;
const VarKind_Regex = 19;
const VarKind_String = 20;
const VarKind_ArrowFunction = 21;
const VarKind_IndexedObjectArray = 22;
const VarKind_ArrayMethodReturn = 23;
const VarKind_Pointer = 24;
const VarKind_Null = 25;
const VarKind_Numeric = 26;

export interface VarClassification {
  kind: number;
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
    scopeVarInterfaceTypes?: string[],
    scopeVarConcreteClasses?: string[],
  ): string;
  getClosureInfoForLambda(lambdaName: string): ClosureInfoResult | null;
  getLiftedFunctionByName(name: string): { returnType?: string } | undefined;
}

interface ClosureInfoResult {
  captures: CaptureInfo[];
  envStructName: string;
}

interface CaptureInfo {
  name: string;
  llvmType: string;
}

interface ObjectMetadataResult {
  keys: string[];
  types: string[];
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
  getObjectMetadata(
    objExpr: ObjectNode,
    targetInterface?: string,
  ): { keys: string[]; types: string[] };
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  emitWarning(message: string, loc?: SourceLocation, suggestion?: string): void;
  getAst(): AST | undefined;
  hasClassGen(): boolean;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  readonly symbolTable: SymbolTable;
  setExpectedArrayElementType(type: "string" | "number" | "boolean" | "pointer" | null): void;
  getExpectedArrayElementType(): "string" | "number" | "boolean" | "pointer" | null;
  setCurrentDeclaredInterfaceType(type: string | undefined): void;
  getCurrentDeclaredInterfaceType(): string | undefined;
  getCurrentClassName(): string | null;
  getMethodReturnType(className: string, methodName: string): string | null;
  getParameterTypeFromAST(paramName: string): string | null;
  resolveImportAlias(localName: string): string;
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
  ensureI64(value: string): string;
  getI64EligibleVars(): string[];
  isUint8ArrayExpression(expr: Expression): boolean;
  setWantsBinaryReturn(value: boolean): void;
  getWantsBinaryReturn(): boolean;
  getLastTypeAssertionSourceVar(): string | null;
  setLastTypeAssertionSourceVar(name: string | null): void;
  setCurrentVarDeclKey(key: string | null): void;
  isStackEligibleKey(key: string): boolean;
  // New method pinned at END of interface: inserting mid-interface shifts
  // native vtable slots (CLAUDE.md rule #5).
  typeOf(expr: Expression): ResolvedType | null;
}

export class VariableAllocator {
  private interfaceAlloc: InterfaceAllocator;
  private mapAlloc: MapAllocator;
  private classAlloc: ClassAllocator;
  private arrayAlloc: ArrayAllocator;

  constructor(private ctx: VariableAllocatorContext) {
    this.interfaceAlloc = new InterfaceAllocator(ctx as any);
    this.mapAlloc = new MapAllocator(ctx as any, this.interfaceAlloc);
    this.classAlloc = new ClassAllocator(ctx as any, this.interfaceAlloc, this.mapAlloc);
    this.arrayAlloc = new ArrayAllocator(ctx as any, this.interfaceAlloc);
  }

  getMapGetClassName(m: MethodCallNode): string | null {
    return this.mapAlloc.getMapGetClassName(m);
  }

  isKnownClass(name: string): boolean {
    if (!name) return false;
    // Also check resolved alias (e.g., import MyGreeter from './greeter' → Greeter)
    const resolved = this.ctx.resolveImportAlias(name);
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return false;
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      if (cls && (cls.name === name || cls.name === resolved)) return true;
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

  getInterface(name: string): InterfaceDeclaration | null {
    return this.interfaceAlloc.getInterface(name);
  }

  private getGenericMethodReturnError(expr: Expression, varName: string): string | null {
    if (expr.type !== "method_call") return null;
    const methodExpr = expr as MethodCallNode;
    const methodObjTyped = methodExpr.object as { type: string };
    if (methodObjTyped.type !== "variable") return null;
    const objName = (methodExpr.object as VariableNode).name;
    const className = this.ctx.symbolTable.getConcreteClass(objName);
    if (!className) return null;
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return null;
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i] as ClassNode;
      if (cls.name !== className) continue;
      if (!cls.typeParameters || cls.typeParameters.length === 0) return null;
      for (let j = 0; j < cls.methods.length; j++) {
        const m = cls.methods[j];
        if (m.isConstructor || m.name !== methodExpr.method) continue;
        if (!m.returnType) return null;
        for (let k = 0; k < cls.typeParameters.length; k++) {
          if (
            m.returnType === cls.typeParameters[k] ||
            m.returnType.includes(cls.typeParameters[k] as string)
          ) {
            return (
              `'${varName}' is assigned from '${objName}.${methodExpr.method}()' which returns generic type '${m.returnType}' — ` +
              `add a type annotation: 'const ${varName}: YourType = ${objName}.${methodExpr.method}()'`
            );
          }
        }
      }
    }
    return null;
  }

  private resolveGenericCallReturnType(expr: Expression): string | null {
    if (expr.type !== "call") return null;
    const callNode = expr as CallNode;
    if (!callNode.typeArgs || callNode.typeArgs.length === 0) return null;
    const ast = this.ctx.getAst();
    if (!ast || !ast.functions) return null;
    let func: FunctionNode | null = null;
    for (let i = 0; i < ast.functions.length; i++) {
      const f = ast.functions[i] as FunctionNode;
      if (f.name === callNode.name) {
        func = f;
        break;
      }
    }
    if (!func || !func.typeParameters || func.typeParameters.length === 0) return null;
    if (!func.returnType) return null;
    let ret = func.returnType;
    if (callNode.typeArgs && callNode.typeArgs.length > 0) {
      for (let i = 0; i < func.typeParameters.length; i++) {
        const param = func.typeParameters[i] || "";
        const arg = callNode.typeArgs[i] || "any";
        ret = ret.split(param).join(arg);
      }
    } else {
      for (let i = 0; i < func.typeParameters.length; i++) {
        const param = func.typeParameters[i] || "";
        if (ret === param) {
          ret = "string";
          break;
        }
      }
    }
    return ret;
  }

  public getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[] {
    return this.interfaceAlloc.getAllInterfaceFields(iface);
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
    return this.interfaceAlloc.isEnumType(typeName);
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
    let kind: number;

    if (declaredInterfaceType) {
      kind = VarKind_DeclaredInterface;
    } else if (isStringArray) {
      kind = VarKind_StringArray;
    } else if (mapGetInterfaceType) {
      kind = VarKind_MapGetInterface;
    } else if (functionInterfaceReturn) {
      kind = VarKind_FunctionInterfaceReturn;
    } else if (methodInterfaceReturn) {
      kind = VarKind_MethodInterfaceReturn;
    } else if (methodArrayReturn) {
      kind = VarKind_MethodArrayReturn;
    } else if (memberAccessInterfaceType) {
      kind = VarKind_MemberAccessInterface;
    } else if (isAwait) {
      kind = VarKind_Await;
    } else if (isPromise) {
      kind = VarKind_Promise;
    } else if (isUint8Array) {
      kind = VarKind_Uint8Array;
    } else if (isClassInstance) {
      kind = VarKind_ClassInstance;
    } else if (typedJsonInterface) {
      kind = VarKind_TypedJsonInterface;
    } else if (isResponse) {
      kind = VarKind_Response;
    } else if (isJSONObject) {
      kind = VarKind_JSONObject;
    } else if (isObject) {
      kind = VarKind_Object;
    } else if (isMap) {
      kind = VarKind_Map;
    } else if (isSet) {
      kind = VarKind_Set;
    } else if (isObjectArray) {
      kind = VarKind_ObjectArray;
    } else if (isArray) {
      kind = VarKind_Array;
    } else if (isRegex) {
      kind = VarKind_Regex;
    } else if (isString) {
      kind = VarKind_String;
    } else if (isArrowFunction) {
      kind = VarKind_ArrowFunction;
    } else if (indexedObjectType) {
      kind = VarKind_IndexedObjectArray;
    } else if (arrayMethodReturnType) {
      kind = VarKind_ArrayMethodReturn;
    } else if (isPointer) {
      kind = VarKind_Pointer;
    } else if (isNull) {
      kind = VarKind_Null;
    } else {
      kind = VarKind_Numeric;
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

  private isNullishValue(value: Expression | null): boolean {
    if (value === null) return true;
    const vType = (value as VariableNode).type as string;
    if (vType === "null" || vType === "undefined") return true;
    if (vType === "variable") {
      const vName = (value as VariableNode).name;
      if (vName === "undefined" || vName === "null") return true;
    }
    return false;
  }

  allocate(stmt: VariableDeclaration, params: string[]): void {
    const existingScope = this.ctx.symbolTable.getScope(stmt.name);
    if (existingScope === "global" && this.ctx.symbolTable.isLLVMConstant(stmt.name)) {
      return;
    }
    if (existingScope === "global" && stmt.value !== null && !this.isNullishValue(stmt.value)) {
      // For global Uint8Array vars, set wantsBinaryReturn so readFileSync etc.
      // dispatch to their binary variants (same as allocateUint8Array does for locals)
      const sym = this.ctx.symbolTable.lookup(stmt.name);
      const isGlobalUint8Array = !!sym && sym.kind === SymbolKind_Uint8Array;
      if (isGlobalUint8Array) {
        this.ctx.setWantsBinaryReturn(true);
      }
      const value = this.ctx.generateExpression(stmt.value, params);
      if (isGlobalUint8Array) {
        this.ctx.setWantsBinaryReturn(false);
      }
      const globalPtr = this.ctx.symbolTable.getAlloca(stmt.name) || "";
      const llvmType = this.ctx.symbolTable.getType(stmt.name) || "i8*";
      if (llvmType.indexOf("*") !== -1) {
        // Bitcast if expression type doesn't match the global's declared pointer type
        // (e.g. .match() returns i8* but global is %StringArray*)
        const valueType = this.ctx.getVariableType(value);
        let storeValue = value;
        if (valueType && valueType !== llvmType && valueType.indexOf("*") !== -1) {
          const cast = this.ctx.nextTemp();
          this.ctx.emit(`${cast} = bitcast ${valueType} ${value} to ${llvmType}`);
          storeValue = cast;
        }
        this.ctx.emit(`store ${llvmType} ${storeValue}, ${llvmType}* ${globalPtr}`);
      } else if (llvmType === "i64") {
        const coerced = this.ctx.ensureI64(value);
        this.ctx.emit(`store i64 ${coerced}, i64* ${globalPtr}`);
      } else if (llvmType === "double") {
        const coerced = this.ctx.ensureDouble(value);
        this.ctx.emit(`store double ${coerced}, double* ${globalPtr}`);
      } else {
        this.ctx.emit(`store ${llvmType} ${value}, ${llvmType}* ${globalPtr}`);
      }
      return;
    }
    if (existingScope === "global") return;

    const stmtValueAsVar = stmt.value as VariableNode;
    const isAstNullLiteral =
      stmtValueAsVar && stmtValueAsVar.type === "variable" && stmtValueAsVar.name === "null";
    if (stmt.value === null || isAstNullLiteral) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      const baseType = stmt.declaredType ? stripNullable(stmt.declaredType) : "";
      if (baseType === "string" || baseType === "i8_ptr" || baseType === "ptr") {
        this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_String, "local");
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
      } else if (baseType === "boolean") {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind_Boolean, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
      } else if (baseType === "number") {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind_Number, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
      } else if (baseType === "string[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%StringArray*",
          SymbolKind_StringArray,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        this.ctx.emit(`store %StringArray* null, %StringArray** ${allocaReg}`);
      } else if (baseType === "boolean[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%Uint8Array*",
          SymbolKind_Uint8Array,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %Uint8Array*`);
        this.ctx.emit(`store %Uint8Array* null, %Uint8Array** ${allocaReg}`);
      } else if (baseType === "number[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%Array*",
          SymbolKind_Array,
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
          SymbolKind_ObjectArray,
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
                SymbolKind_Object,
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
              const allFields = this.getAllInterfaceFields(interfaceDef);
              for (let fi = 0; fi < allFields.length; fi++) {
                const fieldRaw = allFields[fi];
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
                SymbolKind_Object,
                "local",
                createObjectMetadataWithInterface({ keys, types, tsTypes }, baseType),
              );
              this.ctx.emit(`${allocaReg} = alloca i8*`);
              this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
              return;
            }
          }
          this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_Object, "local");
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else if (this.isUnionOfInterfaceTypes(baseType)) {
          this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_Object, "local");
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else if (this.isStringLiteralUnion(baseType)) {
          this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_String, "local");
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else if (this.isEnumType(baseType)) {
          // Enum types are stored as double (numeric constants)
          this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind_Number, "local");
          this.ctx.emit(`${allocaReg} = alloca double`);
          this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        } else if (baseType === "object" || baseType === "any" || baseType === "unknown") {
          // Generic object/any/unknown types are opaque pointers
          this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_Object, "local");
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else {
          // Strict: unrecognized declared type should not silently default to double
          return this.ctx.emitError(
            `cannot determine type for variable '${stmt.name}' with declared type '${baseType}'. ` +
              `Add a supported type annotation or move initialization inline`,
          );
        }
      }
      // Seed symbol-table with declared type so later method/member access on
      // this variable resolves via the declared interface even before any
      // assignment. Fixes #590 — `let sock: Socket; sock = ...; sock.on(...)`.
      if (stmt.declaredType) {
        this.ctx.symbolTable.setResolvedType(stmt.name, parseTypeString(stmt.declaredType));
      }
      return;
    }

    const stmtValue = stmt.value!;
    const stmtValueBase = stmtValue as { type: string };

    if (stmtValueBase.type === "new") {
      const newNode = stmtValue as NewNode;
      if (newNode.className === "URL") {
        this.allocateUrl(stmt, params);
        return;
      }
      if (newNode.className === "URLSearchParams") {
        this.allocateUrlSearchParams(stmt, params);
        return;
      }
    }

    if (stmt.declaredType) {
      const strippedType = stripNullable(stmt.declaredType);
      if (strippedType === "string[]") {
        this.ctx.setExpectedArrayElementType("string");
      } else if (strippedType === "boolean[]") {
        this.ctx.setExpectedArrayElementType("boolean");
      } else if (strippedType === "number[]") {
        this.ctx.setExpectedArrayElementType("number");
      } else if (strippedType.endsWith("[]")) {
        this.ctx.setExpectedArrayElementType("pointer");
      }
    }

    const stmtDeclaredType: string = stmt.declaredType || "";
    const strippedDeclType = stripNullable(stmtDeclaredType);
    // typeOf hits the annotator-populated cache first, then falls through to
    // the Rich resolver for expressions the annotator skipped — no extra
    // fallback needed, since Rich wraps the base resolver internally.
    const resolved = this.ctx.typeOf(stmtValue);
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
      isStringArray = base === "string" && depth === 1;
      isObjectArray =
        depth > 1 || (depth > 0 && base !== "string" && base !== "number" && base !== "boolean");
      isArray = depth === 1 && (base === "number" || base === "boolean");
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
    if (!isObjectArray && strippedDeclType && isObjectArrayTsType(strippedDeclType)) {
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
    if (!isClassInstance && strippedDeclType && this.isKnownClass(strippedDeclType)) {
      isClassInstance = true;
    }
    if (!isClassInstance && nodeType === "index_access") {
      const indexClassName = this.getIndexAccessClassName(stmtValue);
      if (indexClassName) {
        isClassInstance = true;
      }
    }
    if (!isClassInstance && nodeType === "member_access") {
      const memberClassName = this.getMemberAccessClassName(stmtValue);
      if (memberClassName) {
        isClassInstance = true;
      }
    }
    // Detect Uint8Array from expression analysis (e.g. getEmbeddedFileAsUint8Array)
    if (!isUint8Array && this.ctx.isUint8ArrayExpression(stmtValue)) {
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

    if (this.isFunctionValueExpression(stmt, stmtValue, nodeType)) {
      this.allocateFunctionValue(stmt, params);
      return;
    }

    if (!isString && !isStringArray && !isObjectArray && !isArray && !isClassInstance) {
      const genericReturn = this.resolveGenericCallReturnType(stmtValue);
      if (genericReturn === "string") isString = true;
      else if (genericReturn === "string[]") isStringArray = true;
      else if (genericReturn && genericReturn.endsWith("[]")) isObjectArray = true;
    }

    if (
      (isObjectArray || isStringArray) &&
      nodeType === "method_call" &&
      (stmtValue as MethodCallNode).method === "map" &&
      (stmtValue as MethodCallNode).args.length === 1
    ) {
      const mapArg = (stmtValue as MethodCallNode).args[0];
      if (mapArg.type === "arrow_function") {
        const arrowRet = (mapArg as ArrowFunctionNode).returnType;
        if (arrowRet === "number" || arrowRet === "boolean") {
          isObjectArray = false;
          isStringArray = false;
          isArray = true;
        }
      }
    }

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

    const declLine = stmt.loc ? stmt.loc.line : (stmt.line ?? -1);
    const declCol = stmt.loc ? stmt.loc.column : -1;
    const declKey = stmt.name + ":" + declLine + ":" + declCol;
    this.ctx.setCurrentVarDeclKey(declKey);
    switch (classification.kind) {
      case VarKind_DeclaredInterface:
        this.allocateDeclaredInterface(stmt, params, classification.declaredInterfaceType!);
        break;
      case VarKind_StringArray:
        this.allocateStringArray(stmt, params);
        break;
      case VarKind_MapGetInterface:
        this.allocateMapGetInterface(stmt, params, classification.mapGetInterfaceType!);
        break;
      case VarKind_FunctionInterfaceReturn:
        this.allocateFunctionInterfaceReturn(stmt, params, classification.functionInterfaceReturn!);
        break;
      case VarKind_MethodInterfaceReturn:
        this.allocateMethodInterfaceReturn(stmt, params, classification.methodInterfaceReturn!);
        break;
      case VarKind_MethodArrayReturn:
        this.allocateMethodArrayReturn(stmt, params, classification.methodArrayReturn!);
        break;
      case VarKind_MemberAccessInterface:
        this.allocateMemberAccessInterface(stmt, params, classification.memberAccessInterfaceType!);
        break;
      case VarKind_Await:
        this.allocateAwaitResult(stmt, params);
        break;
      case VarKind_Promise:
        this.allocatePromise(stmt, params);
        break;
      case VarKind_Uint8Array:
        this.allocateUint8Array(stmt, params);
        break;
      case VarKind_ClassInstance:
        this.allocateClassInstance(stmt, params);
        break;
      case VarKind_TypedJsonInterface:
        this.allocateTypedJsonInterface(stmt, params, classification.typedJsonInterface!);
        break;
      case VarKind_Response:
        this.allocateResponse(stmt, params);
        break;
      case VarKind_JSONObject:
        this.allocateJSONObject(stmt, params);
        break;
      case VarKind_Object:
        this.allocateObject(stmt, params);
        break;
      case VarKind_Map:
        this.allocateMap(stmt, params);
        break;
      case VarKind_Set:
        this.allocateSet(stmt, params);
        break;
      case VarKind_ObjectArray:
        this.allocateObjectArray(stmt, params);
        break;
      case VarKind_Array:
        this.allocateArray(stmt, params);
        break;
      case VarKind_Regex:
        this.allocateRegex(stmt, params);
        break;
      case VarKind_String:
        this.allocateString(stmt, params);
        break;
      case VarKind_ArrowFunction:
        this.allocateArrowFunction(stmt, params);
        break;
      case VarKind_IndexedObjectArray:
        this.allocateIndexedObjectArray(stmt, params, classification.indexedObjectType!);
        break;
      case VarKind_ArrayMethodReturn:
        this.allocateArrayMethodReturn(stmt, params, classification.arrayMethodReturnType!);
        break;
      case VarKind_Pointer:
        this.allocatePointer(stmt, params);
        break;
      case VarKind_Null:
        this.allocateNullPointer(stmt);
        break;
      case VarKind_Numeric:
        // Warn when a non-trivially-numeric expression falls through to Numeric.
        // VarKind_Numeric is correct for number/boolean literals and arithmetic,
        // but suspicious for calls/method calls that might return non-numeric types.
        if (nodeType === "call" || nodeType === "method_call") {
          if (!stmt.declaredType) {
            const genericErr = this.getGenericMethodReturnError(stmtValue, stmt.name);
            if (genericErr) {
              return this.ctx.emitError(genericErr);
            }
          }
          this.ctx.emitWarning(
            `variable '${stmt.name}' classified as numeric from expression type '${nodeType}' — ` +
              `if this is wrong, add a type annotation`,
          );
        }
        this.allocateNumeric(stmt, params);
        break;
    }

    this.ctx.setCurrentVarDeclKey(null);

    if (resolved && !isNull) {
      this.ctx.symbolTable.setResolvedType(stmt.name, resolved);
    }
    if (stmt.declaredType && !isNull) {
      this.ctx.symbolTable.setResolvedType(stmt.name, parseTypeString(stmt.declaredType));
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
      if (!interfaceDefResult) {
        return this.ctx.emitError(
          `interface '${interfaceName}' not found when allocating function return variable '${stmt.name}'`,
        );
      }
      const allFields = this.getAllInterfaceFields(interfaceDefResult as InterfaceDeclaration);
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
      SymbolKind_Object,
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
    } else if (interfaceName === "HttpResponse") {
      keys.push("status");
      keys.push("body");
      keys.push("headers");
      types.push("double");
      types.push("i8*");
      types.push("i8*");
      tsTypes.push("number");
      tsTypes.push("string");
      tsTypes.push("string");
    } else if (interfaceName === "HttpRequest") {
      keys.push("method");
      keys.push("path");
      keys.push("body");
      keys.push("contentType");
      keys.push("headers");
      types.push("i8*");
      types.push("i8*");
      types.push("i8*");
      types.push("i8*");
      types.push("i8*");
      tsTypes.push("string");
      tsTypes.push("string");
      tsTypes.push("string");
      tsTypes.push("string");
      tsTypes.push("string");
    } else if (interfaceName === "WsEvent") {
      keys.push("data");
      keys.push("event");
      keys.push("connId");
      types.push("i8*");
      types.push("i8*");
      types.push("i8*");
      tsTypes.push("string");
      tsTypes.push("string");
      tsTypes.push("string");
    } else if (interfaceName === "MultipartPart") {
      keys.push("name");
      keys.push("filename");
      keys.push("contentType");
      keys.push("data");
      keys.push("dataLen");
      types.push("i8*");
      types.push("i8*");
      types.push("i8*");
      types.push("i8*");
      types.push("double");
      tsTypes.push("string");
      tsTypes.push("string");
      tsTypes.push("string");
      tsTypes.push("string");
      tsTypes.push("number");
    } else {
      const interfaceDefResult = this.getInterface(interfaceName);
      if (!interfaceDefResult) {
        return this.ctx.emitError(
          `interface '${interfaceName}' not found when allocating method return variable '${stmt.name}'`,
        );
      }
      const allFields = this.getAllInterfaceFields(interfaceDefResult as InterfaceDeclaration);
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
      SymbolKind_Object,
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
    this.arrayAlloc.allocateMethodArrayReturn(stmt, params, elementType);
  }

  private getDeclaredInterfaceType(stmt: VariableDeclaration): string | null {
    return this.interfaceAlloc.getDeclaredInterfaceType(stmt);
  }

  parseInlineObjectType(typeStr: string): InterfaceField[] | null {
    return this.interfaceAlloc.parseInlineObjectType(typeStr);
  }

  private allocateDeclaredInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    this.interfaceAlloc.allocateDeclaredInterface(stmt, params, interfaceName);
  }

  private getMapGetInterfaceType(expr: Expression): string | null {
    const result = this.ctx.typeResolver?.getMapGetInterfaceType(expr);
    if (result) {
      return result;
    }
    return this.mapAlloc.getMapGetInterfaceType(expr);
  }

  private allocateMapGetInterface(
    stmt: VariableDeclaration,
    params: string[],
    interfaceName: string,
  ): void {
    this.mapAlloc.allocateMapGetInterface(stmt, params, interfaceName);
  }

  private getMemberAccessInterfaceType(expr: Expression | null): string | null {
    if (!expr) return null;
    const exprBase = expr as ExprBase;
    if (exprBase.type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;
    const objBase = memberExpr.object as ExprBase;
    let objectInterfaceType: string | null = null;
    if (objBase.type === "method_call") {
      const mc = memberExpr.object as MethodCallNode;
      const mcObjBase = mc.object as ExprBase;
      let mcClassName: string | null = null;
      if (mcObjBase.type === "variable") {
        const mcVar = mc.object as VariableNode;
        const concrete = this.ctx.symbolTable.getConcreteClass(mcVar.name);
        if (concrete) mcClassName = concrete;
        else if (this.ctx.symbolTable.isClass(mcVar.name)) {
          const ci = this.ctx.symbolTable.getClassInfo(mcVar.name);
          if (ci) mcClassName = ci.className;
        }
      } else if (mcObjBase.type === "this") {
        mcClassName = this.ctx.getCurrentClassName();
      }
      if (mcClassName) {
        const rt = this.ctx.getMethodReturnType(mcClassName, mc.method);
        if (rt && !isAnyArrayTsType(rt)) {
          objectInterfaceType = stripNullable(rt);
        }
      }
    } else if (objBase.type === "call") {
      const ce = memberExpr.object as CallNode;
      const ast = this.ctx.getAst();
      if (ast && ce.name) {
        const funcs = ast.functions || [];
        for (let i = 0; i < funcs.length; i++) {
          const fn = funcs[i];
          if (fn.name === ce.name && fn.returnType && !isAnyArrayTsType(fn.returnType)) {
            objectInterfaceType = stripNullable(fn.returnType);
            break;
          }
        }
      }
    } else if (objBase.type === "variable") {
      const varName = (memberExpr.object as VariableNode).name;
      if (!varName) return null;
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
              !isAnyArrayTsType(propType) &&
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
    } else {
      return null;
    }
    if (!objectInterfaceType) return null;
    const objectInterface = this.getInterface(objectInterfaceType);
    if (!objectInterface) return null;
    const objIface = objectInterface as InterfaceDeclaration;
    if (!objIface.fields) return null;
    const allObjFields = this.getAllInterfaceFields(objIface);
    for (let i = 0; i < allObjFields.length; i++) {
      const field = allObjFields[i] as { name: string; type: string };
      if (!field || !field.name) continue;
      const fieldName = stripOptional(field.name);
      if (fieldName === memberExpr.property) {
        const fieldType = field.type;
        if (
          fieldType &&
          !isAnyArrayTsType(fieldType) &&
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
    this.interfaceAlloc.allocateMemberAccessInterface(stmt, params, interfaceName);
  }

  private allocateClassInstance(stmt: VariableDeclaration, params: string[]): void {
    this.classAlloc.allocateClassInstance(stmt, params);
  }

  private allocatePromise(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%Promise*", SymbolKind_Object, "local");
    this.ctx.emit(`${allocaReg} = alloca %Promise*`);

    const promisePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %Promise* ${promisePtr}, %Promise** ${allocaReg}`);
  }

  /**
   * For `await userAsyncFn()`, look up the function in the AST and extract
   * the inner type from its declared `Promise<T>` return. Returns the LLVM
   * type + SymbolKind pair to allocate, or null if the return type doesn't
   * map to a known struct pointer (in which case the caller falls through
   * to its existing i8* default).
   *
   * Currently handles: Response. Extend here when other opaque interface
   * returns start showing up in user code.
   */
  private tryUnwrapAsyncCallReturnType(
    fnName: string,
  ): { llvmType: string; symbolKind: number } | null {
    const ast = this.ctx.getAst();
    if (!ast || !ast.functions) return null;
    for (let i = 0; i < ast.functions.length; i++) {
      const fn = ast.functions[i];
      if (fn.name !== fnName || !fn.async || !fn.returnType) continue;
      // returnType shape is "Promise<Foo>" — strip the wrapper.
      const rt = fn.returnType;
      if (!rt.startsWith("Promise<") || !rt.endsWith(">")) return null;
      const inner = rt.slice("Promise<".length, rt.length - 1).trim();
      if (inner === "Response") {
        return { llvmType: "%__FetchResponse*", symbolKind: SymbolKind_Object };
      }
      return null;
    }
    return null;
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
        (methodCall.method === "all" || methodCall.method === "allSettled")
      ) {
        const allocaReg = this.ctx.nextAllocaReg(stmt.name);
        this.ctx.defineVariable(
          stmt.name,
          allocaReg,
          "%ObjectArray*",
          SymbolKind_ObjectArray,
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
          SymbolKind_StringArray,
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
        this.ctx.defineVariable(stmt.name, allocaReg, "%StatResult*", SymbolKind_Object, "local");
        this.ctx.emit(`${allocaReg} = alloca %StatResult*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        const castReg = this.ctx.nextTemp();
        this.ctx.emit(`${castReg} = bitcast i8* ${value} to %StatResult*`);
        this.ctx.emit(`store %StatResult* ${castReg}, %StatResult** ${allocaReg}`);
        return;
      }
      // await child_process.exec(cmd) → %SpawnSyncResult*
      const cpObjName = objBase.type === "variable" ? (methodCall.object as VariableNode).name : "";
      if ((cpObjName === "child_process" || cpObjName === "cp") && methodCall.method === "exec") {
        const allocaReg = this.ctx.nextAllocaReg(stmt.name);
        this.ctx.defineVariable(
          stmt.name,
          allocaReg,
          "%SpawnSyncResult*",
          SymbolKind_Object,
          "local",
        );
        this.ctx.emit(`${allocaReg} = alloca %SpawnSyncResult*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        const castReg = this.ctx.nextTemp();
        this.ctx.emit(`${castReg} = bitcast i8* ${value} to %SpawnSyncResult*`);
        this.ctx.emit(`store %SpawnSyncResult* ${castReg}, %SpawnSyncResult** ${allocaReg}`);
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
          SymbolKind_Object,
          "local",
        );
        this.ctx.emit(`${allocaReg} = alloca %__FetchResponse*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store %__FetchResponse* ${value}, %__FetchResponse** ${allocaReg}`);
        return;
      }
      // await <userAsyncFn>() — unwrap Promise<T> from the function's
      // declared return type and allocate based on T. Previously this
      // branch only handled built-in async (fetch), so user-defined
      // `async function httpGet(): Promise<Response>` fell through to the
      // i8* fallback and the Response struct pointer got corrupted
      // (dapweb NOTES #20).
      const asyncReturnUnwrap = this.tryUnwrapAsyncCallReturnType(callNode.name);
      if (asyncReturnUnwrap) {
        const { llvmType, symbolKind } = asyncReturnUnwrap;
        const allocaReg = this.ctx.nextAllocaReg(stmt.name);
        this.ctx.defineVariable(stmt.name, allocaReg, llvmType, symbolKind, "local");
        this.ctx.emit(`${allocaReg} = alloca ${llvmType}`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        // value from @__Promise_await is i8*; bitcast to the struct pointer.
        const cast = this.ctx.nextTemp();
        this.ctx.emit(`${cast} = bitcast i8* ${value} to ${llvmType}`);
        this.ctx.emit(`store ${llvmType} ${cast}, ${llvmType}* ${allocaReg}`);
        return;
      }
    }

    if (stmt.declaredType === "Response") {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(
        stmt.name,
        allocaReg,
        "%__FetchResponse*",
        SymbolKind_Object,
        "local",
      );
      this.ctx.emit(`${allocaReg} = alloca %__FetchResponse*`);
      const value = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store %__FetchResponse* ${value}, %__FetchResponse** ${allocaReg}`);
      return;
    }

    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_String, "local");
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
    this.ctx.defineVariable(stmt.name, allocaReg, structType, SymbolKind_Object, "local");
    this.ctx.symbolTable.setRawInterfaceType(stmt.name, interfaceName);
    this.ctx.emit(`${allocaReg} = alloca ${structType}`);

    const structPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store ${structType} ${structPtr}, ${structType}* ${allocaReg}`);
  }

  private allocateResponse(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "%__FetchResponse*", SymbolKind_Object, "local");
    this.ctx.emit(`${allocaReg} = alloca %__FetchResponse*`);

    const responsePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %__FetchResponse* ${responsePtr}, %__FetchResponse** ${allocaReg}`);
  }

  private allocateJSONObject(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const interfaceName = this.ctx.getJSONParseInterface(stmt.value!);
    if (!interfaceName) {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_JSON, "local");
      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
      return;
    }

    if (interfaceName === "number[]") {
      this.ctx.defineVariable(stmt.name, allocaReg, "%Array*", SymbolKind_Array, "local");
      this.ctx.emit(`${allocaReg} = alloca %Array*`);
      const arrPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store %Array* ${arrPtr}, %Array** ${allocaReg}`);
      return;
    }

    const interfaceDefResult = this.getInterface(interfaceName);

    if (!interfaceDefResult) {
      this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_JSON, "local");
      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
    } else {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      const allFields = this.getAllInterfaceFields(interfaceDef);
      for (let i = 0; i < allFields.length; i++) {
        const field = allFields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        tsTypes.push(field.type);
        types.push(this.convertTsTypeJson(field.type));
      }

      this.ctx.defineVariableWithMetadata(
        stmt.name,
        allocaReg,
        "i8*",
        SymbolKind_JSON,
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
      const allFields = this.getAllInterfaceFields(interfaceDef);
      for (let i = 0; i < allFields.length; i++) {
        const field = allFields[i] as { name: string; type: string };
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
      SymbolKind_Object,
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
    this.mapAlloc.allocateMap(stmt, params);
  }

  private allocateSet(stmt: VariableDeclaration, params: string[]): void {
    this.mapAlloc.allocateSet(stmt, params);
  }

  private allocateStringArray(stmt: VariableDeclaration, params: string[]): void {
    this.arrayAlloc.allocateStringArray(stmt, params);
  }

  private allocateArray(stmt: VariableDeclaration, params: string[]): void {
    this.arrayAlloc.allocateArray(stmt, params);
  }

  private allocateUint8Array(stmt: VariableDeclaration, params: string[]): void {
    this.arrayAlloc.allocateUint8Array(stmt, params);
  }

  private allocateObjectArray(stmt: VariableDeclaration, params: string[]): void {
    this.arrayAlloc.allocateObjectArray(stmt, params);
  }

  private allocateRegex(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_Regex, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateUrl(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.symbolTable.defineUrl(stmt.name, allocaReg, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateUrlSearchParams(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.symbolTable.defineUrlSearchParams(stmt.name, allocaReg, "local");
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateString(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_String, "local");
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
          SymbolKind_ObjectArray,
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

    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_JSON, "local");
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
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind_Number, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        return;
      }
      if (baseType === "boolean") {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", SymbolKind_Boolean, "local");
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        return;
      }
      if (baseType === "string") {
        this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_String, "local");
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        return;
      }
      if (baseType === "string[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%StringArray*",
          SymbolKind_StringArray,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        this.ctx.emit(`store %StringArray* null, %StringArray** ${allocaReg}`);
        return;
      }
      if (baseType === "boolean[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%Uint8Array*",
          SymbolKind_Uint8Array,
          "local",
          createPointerAllocaMetadata(),
        );
        this.ctx.emit(`${allocaReg} = alloca %Uint8Array*`);
        this.ctx.emit(`store %Uint8Array* null, %Uint8Array** ${allocaReg}`);
        return;
      }
      if (baseType === "number[]") {
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "%Array*",
          SymbolKind_Array,
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
            SymbolKind_Object,
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
        const allFields = this.getAllInterfaceFields(interfaceDef);
        for (let fi = 0; fi < allFields.length; fi++) {
          const field = allFields[fi] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.convertTsType(field.type));
          tsTypes.push(field.type);
        }
        this.ctx.defineVariableWithMetadata(
          stmt.name,
          allocaReg,
          "i8*",
          SymbolKind_Object,
          "local",
          createObjectMetadataWithInterface({ keys, types, tsTypes }, baseType),
        );
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        return;
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, "i8*", SymbolKind_String, "local");
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
      this.ctx.defineVariable(stmt.name, allocaReg, valueType, SymbolKind_Object, "local");
      this.ctx.emit(`${allocaReg} = alloca double`);
      this.ctx.emit(`store double ${value}, double* ${allocaReg}`);
    } else if (valueType && valueType !== "double" && valueType.indexOf("*") !== -1) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(stmt.name, allocaReg, valueType, SymbolKind_Object, "local");
      this.ctx.emit(`${allocaReg} = alloca ${valueType}`);
      this.ctx.emit(`store ${valueType} ${value}, ${valueType}* ${allocaReg}`);
    } else {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      const isBoolVal =
        stmt.value!.type === "boolean" ||
        (stmt.declaredType && stripNullable(stmt.declaredType) === "boolean");
      const symKind = isBoolVal ? SymbolKind_Boolean : SymbolKind_Number;
      if (
        this.isI64Eligible(stmt.name) &&
        (valueType === "i64" || valueType === "double" || valueType === "i32")
      ) {
        this.ctx.defineVariable(stmt.name, allocaReg, "i64", symKind, "local");
        this.ctx.emit(`${allocaReg} = alloca i64`);
        if (valueType === "double") {
          const converted = this.ctx.nextTemp();
          this.ctx.emit(`${converted} = fptosi double ${value} to i64`);
          this.ctx.emit(`store i64 ${converted}, i64* ${allocaReg}`);
        } else if (valueType === "i32") {
          const converted = this.ctx.nextTemp();
          this.ctx.emit(`${converted} = sext i32 ${value} to i64`);
          this.ctx.emit(`store i64 ${converted}, i64* ${allocaReg}`);
        } else {
          this.ctx.emit(`store i64 ${value}, i64* ${allocaReg}`);
        }
      } else {
        this.ctx.defineVariable(stmt.name, allocaReg, "double", symKind, "local");
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
          const doubleVal = value === "0" ? "0.0" : value;
          this.ctx.emit(`store double ${doubleVal}, double* ${allocaReg}`);
        }
      }
    }
  }

  private getLambdaReturnType(lambdaName: string): string | undefined {
    const lifted = this.ctx.arrowFunctionGen.getLiftedFunctionByName(lambdaName);
    if (lifted && lifted.returnType) return lifted.returnType;
    return undefined;
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

      // Capture by value: allocate env struct and copy current variable values into it.
      // Note: this means mutations in the closure don't affect the outer scope.
      // Capture-by-reference (heap boxing) is deferred — the native compiler can't
      // handle the heap boxing code path correctly in self-hosting yet.
      const structSize = captures.length * 8;
      const envMemReg = this.ctx.nextTemp();
      this.ctx.emit(`${envMemReg} = call i8* @GC_malloc(i64 ${structSize})`);

      const envTypedReg = this.ctx.nextTemp();
      this.ctx.emit(`${envTypedReg} = bitcast i8* ${envMemReg} to ${closureInfo.envStructName}*`);

      for (let i = 0; i < captures.length; i++) {
        const captureItem = captures[i] as CaptureInfo;
        const allocaReg = this.ctx.symbolTable.getAlloca(captureItem.name);
        if (!allocaReg) {
          return this.ctx.emitError(
            `Closure capture error: variable '${captureItem.name}' not found`,
          );
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
        SymbolKind_Closure,
        "local",
        createClosureMetadataSymbol({
          lambdaName,
          envStructName: closureInfo.envStructName,
          envPtrRegister: envMemReg,
          captures: captures,
          returnType: this.getLambdaReturnType(lambdaName),
        }),
      );
    } else {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariableWithMetadata(
        stmt.name,
        allocaReg,
        "i8*",
        SymbolKind_Closure,
        "local",
        createClosureMetadataSymbol({
          lambdaName,
          envStructName: "",
          envPtrRegister: "null",
          captures: [],
          returnType: this.getLambdaReturnType(lambdaName),
        }),
      );
    }
  }

  private getMemberAccessClassName(expr: Expression | null): string | null {
    return this.classAlloc.getMemberAccessClassName(expr);
  }

  private getIndexAccessClassName(expr: Expression | null): string | null {
    return this.classAlloc.getIndexAccessClassName(expr);
  }

  private getIndexedObjectArrayType(
    expr: Expression | null,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    return this.arrayAlloc.getIndexedObjectArrayType(expr);
  }

  getInterfaceFieldTypeByName(interfaceName: string, fieldName: string): string | null {
    const ifaceResult = this.getInterface(interfaceName);
    if (!ifaceResult) return null;
    const iface = ifaceResult as InterfaceDeclaration;
    const allFields = this.getAllInterfaceFields(iface);
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as { name: string; type: string };
      if (f.name === fieldName) {
        return f.type;
      }
    }
    return null;
  }

  getTypeInfoForElementType(
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
      const allFields = this.getAllInterfaceFields(interfaceDef);
      for (let i = 0; i < allFields.length; i++) {
        const field = allFields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.convertTsType(field.type));
        tsTypes.push(field.type);
      }
      return { keys, types, tsTypes };
    }

    const typeAliasRaw = this.getTypeAlias(elementType);
    if (typeAliasRaw) {
      const typeAlias = typeAliasRaw as TypeAliasDeclaration;
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
      return { keys: result.keys, types: result.types, tsTypes: result.tsTypes };
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
    const firstFields = this.getAllInterfaceFields(firstInterface);
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as InterfaceDeclaration;
        const ifaceFields = this.getAllInterfaceFields(ifaceTyped);
        let found = false;
        for (let fj = 0; fj < ifaceFields.length; fj++) {
          const f = ifaceFields[fj] as { name: string; type: string };
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
    this.arrayAlloc.allocateIndexedObjectArray(stmt, params, typeInfo);
  }

  convertTsType(tsType: string): string {
    return this.interfaceAlloc.convertTsType(tsType);
  }

  private convertTsTypeJson(tsType: string): string {
    return tsTypeToLlvmJson(tsType);
  }

  private getArrayMethodReturnType(
    expr: Expression | null,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    return this.arrayAlloc.getArrayMethodReturnType(expr);
  }

  private allocateArrayMethodReturn(
    stmt: VariableDeclaration,
    params: string[],
    typeInfo: UnionCommonFields,
  ): void {
    this.arrayAlloc.allocateArrayMethodReturn(stmt, params, typeInfo);
  }

  private isFunctionValueExpression(
    stmt: VariableDeclaration,
    stmtValue: Expression,
    nodeType: string,
  ): boolean {
    if (stmt.declaredType && stmt.declaredType.indexOf("=>") !== -1) return true;
    if (nodeType !== "call") return false;
    const callExpr = stmtValue as CallNode;
    const func = this.findFunctionInAST(callExpr.name);
    if (func && func.returnType && func.returnType.indexOf("=>") !== -1) return true;
    return false;
  }

  private findFunctionInAST(name: string): FunctionNode | null {
    const ast = this.ctx.getAst();
    if (!ast || !ast.functions) return null;
    const resolved = this.ctx.resolveImportAlias(name);
    for (let i = 0; i < ast.functions.length; i++) {
      const f = ast.functions[i];
      if (f && (f.name === name || f.name === resolved)) return f;
    }
    return null;
  }

  private parseFunctionTypeSignature(typeStr: string): {
    paramCount: number;
    paramTypes: string[];
    returnType: string;
  } {
    const arrowIdx = typeStr.indexOf("=>");
    if (arrowIdx === -1) return { paramCount: 0, paramTypes: [], returnType: "void" };
    const retPart = typeStr.substring(arrowIdx + 2).trim();
    const paramPart = typeStr.substring(0, arrowIdx).trim();
    let inner = paramPart;
    if (inner.startsWith("(") && inner.endsWith(")")) {
      inner = inner.substring(1, inner.length - 1).trim();
    }
    if (inner.length === 0) return { paramCount: 0, paramTypes: [], returnType: retPart };
    const parts = inner.split(",");
    const paramTypes: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      const colonIdx = p.indexOf(":");
      if (colonIdx !== -1) {
        paramTypes.push(p.substring(colonIdx + 1).trim());
      } else {
        paramTypes.push("number");
      }
    }
    return { paramCount: paramTypes.length, paramTypes, returnType: retPart };
  }

  private allocateFunctionValue(stmt: VariableDeclaration, params: string[]): void {
    if (!stmt.value) return;
    let funcTypeStr = stmt.declaredType || "";
    if (!funcTypeStr || funcTypeStr.indexOf("=>") === -1) {
      const callExpr = stmt.value as CallNode;
      const func = this.findFunctionInAST(callExpr.name);
      if (func && func.returnType) funcTypeStr = func.returnType;
    }
    const sig = this.parseFunctionTypeSignature(funcTypeStr);
    const value = this.ctx.generateExpression(stmt.value, params);
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
    this.ctx.defineVariableWithMetadata(
      stmt.name,
      allocaReg,
      "i8*",
      SymbolKind_Closure,
      "local",
      createClosureMetadataSymbol({
        lambdaName: "",
        envStructName: sig.paramTypes.join(","),
        envPtrRegister: "null",
        captures: [],
        returnType: sig.returnType,
      }),
    );
  }
}
