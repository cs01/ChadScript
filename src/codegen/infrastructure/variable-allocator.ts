import { Expression, NewNode, AST, VariableDeclaration, InterfaceDeclaration, InterfaceField, ObjectNode, IndexAccessNode, MemberAccessNode, VariableNode, TypeAliasDeclaration, TypeAssertionNode, MethodCallNode, CommonField, BinaryNode, MapNode, SetNode } from '../../ast/types.js';
import { SymbolKind, SymbolTable, ObjectMetadata, MapMetadata, ClassMetadata, ClosureMetadata, SetMetadata } from './symbol-table.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import { TypeResolver, UnionCommonFields } from './type-resolver/index.js';
import { stripOptional, tsTypeToLlvm as tsTypeToLlvmUtil, tsTypeToLlvmJson as tsTypeToLlvmJsonUtil } from './type-system.js';

interface ExprBase { type: string; }

interface ClassGeneratorLike {
  getClassFields(className: string): { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' }[];
  getFieldInfo(className: string, fieldName: string): FieldInfo | null;
  thisPointer?: string | null;
  currentClassName?: string | null;
}

interface FieldInfo {
  index: number;
  type: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean';
  tsType?: string;
}

interface ArrowFunctionGeneratorLike {
  generateArrowFunction(expr: Expression | null, params: string[], returnType?: string | { paramTypes?: string[], returnType?: string }, scopeVarNames?: string[], scopeVarTypes?: string[]): string;
  getClosureInfoForLambda(lambdaName: string): ClosureInfoResult | null;
}

interface ClosureInfoResult {
  envStructName: string;
  captures: CaptureInfo[];
}

interface CaptureInfo {
  name: string;
  llvmType: string;
}

interface ExpressionGeneratorLike {
  arrowFunctionGen: ArrowFunctionGeneratorLike;
}

type VariableMetadata = {
  objectMetadata?: ObjectMetadata;
  classMetadata?: ClassMetadata;
  closureMetadata?: ClosureMetadata;
  mapMetadata?: MapMetadata;
  setMetadata?: SetMetadata;
  interfaceType?: string;
  isPointerAlloca?: boolean;
};

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
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: SymbolKind, scope: 'local' | 'global', metadata?: VariableMetadata): void;
  generateExpression(expr: Expression, params: string[]): string;
  isStringExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  isStringArrayExpression(expr: Expression): boolean;
  isObjectArrayExpression(expr: Expression): boolean;
  getObjectArrayElementType(expr: Expression): string | null;
  isObjectExpression(expr: Expression): boolean;
  isMapExpression(expr: Expression): boolean;
  isSetExpression(expr: Expression): boolean;
  isRegexExpression(expr: Expression): boolean;
  isClassInstanceExpression(expr: Expression): boolean;
  isPromiseExpression(expr: Expression): boolean;
  isResponseExpression(expr: Expression): boolean;
  isJSONParseExpression(expr: Expression): boolean;
  isAwaitExpression(expr: Expression): boolean;
  getVariableType(name: string): string | undefined;
  currentDeclaredMapType: string | undefined;
  currentDeclaredSetType: string | undefined;
  getTypedJsonInterface(expr: Expression): string | null;
  getFunctionCallInterfaceReturn(expr: Expression): string | null;
  getMethodCallInterfaceReturn(expr: Expression): string | null;
  getMethodCallArrayReturn(expr: Expression): { elementType: string; fields: { name: string; type: string }[] } | null;
  getJSONParseInterface(expr: Expression): string | null;
  getObjectMetadata(objExpr: ObjectNode): { keys: string[]; types: string[] };
  formatCodegenError(message: string, suggestion?: string): string;
  ast: AST;
  classGen: ClassGeneratorLike;
  symbolTable: SymbolTable;
  exprGen: ExpressionGeneratorLike;
  expectedArrayElementType: 'string' | 'number' | 'boolean' | 'pointer' | null;
  currentDeclaredInterfaceType: string | undefined;
  currentClassName: string | null;
  typeChecker?: TypeChecker | null;
  typeResolver?: TypeResolver;
}

export class VariableAllocator {
  constructor(private ctx: VariableAllocatorContext) {}

  private getInterface(name: string): InterfaceDeclaration | null {
    if (!name) return null;
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getInterface(name);
    }
    if (!this.ctx.ast.interfaces) return null;
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i] as InterfaceDeclaration;
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
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getTypeAlias(name);
    }
    if (!this.ctx.ast.typeAliases) return null;
    for (let i = 0; i < this.ctx.ast.typeAliases.length; i++) {
      const ta = this.ctx.ast.typeAliases[i] as TypeAliasDeclaration;
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

  private isEnumType(typeName: string): boolean {
    if (!this.ctx.ast.enums) return false;
    let checkType = typeName;
    if (checkType.indexOf(' | ') !== -1) {
      const parts = checkType.split(' | ');
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j].trim();
        if (part !== 'undefined' && part !== 'null') {
          checkType = part;
          break;
        }
      }
    }
    for (let i = 0; i < this.ctx.ast.enums.length; i++) {
      if (this.ctx.ast.enums[i].name === checkType) {
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
      resolvedType = typeAlias.unionMembers.join(' | ');
    }
    if (resolvedType.indexOf('|') === -1) {
      if (this.getTypeAlias(resolvedType)) return true;
      const firstChar = resolvedType.charAt(0);
      if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
        if (this.isEnumType(resolvedType)) return false;
        return true;
      }
      return false;
    }
    const parts = resolvedType.split('|');
    let hasNonPrimitive = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part === 'undefined' || part === 'null') continue;
      if (part === 'string' || part === 'number' || part === 'boolean') continue;
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

  allocate(stmt: VariableDeclaration, params: string[]): void {
    const existingSymbol = this.ctx.symbolTable.lookup(stmt.name);
    if (existingSymbol && existingSymbol.scope === 'global' && stmt.value !== null) {
      const value = this.ctx.generateExpression(stmt.value, params);
      const globalPtr = existingSymbol.allocaRegister;
      const llvmType = existingSymbol.llvmType;
      if (llvmType.indexOf('*') !== -1) {
        this.ctx.emit(`store ${llvmType} ${value}, ${llvmType}* ${globalPtr}`);
      } else if (llvmType === '%Array' || llvmType === '%StringArray' || llvmType === '%Map' || llvmType === '%Set') {
        const loadedValue = this.ctx.nextTemp();
        this.ctx.emit(`${loadedValue} = load ${llvmType}, ${llvmType}* ${value}`);
        this.ctx.emit(`store ${llvmType} ${loadedValue}, ${llvmType}* ${globalPtr}`);
      } else {
        this.ctx.emit(`store ${llvmType} ${value}, ${llvmType}* ${globalPtr}`);
      }
      return;
    }

    if (stmt.value === null) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      const baseType = stmt.declaredType ? stmt.declaredType.replace(/ \| undefined$/, '').replace(/ \| null$/, '').replace(/undefined \| /, '').replace(/null \| /, '').trim() : '';
      if (baseType === 'string') {
        this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
      } else if (baseType === 'boolean') {
        this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
      } else if (baseType === 'number') {
        this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
      } else if (baseType === 'string[]') {
        this.ctx.defineVariable(stmt.name, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        this.ctx.emit(`store %StringArray* null, %StringArray** ${allocaReg}`);
      } else if (baseType === 'number[]' || baseType === 'boolean[]') {
        this.ctx.defineVariable(stmt.name, allocaReg, '%Array*', SymbolKind.Array, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %Array*`);
        this.ctx.emit(`store %Array* null, %Array** ${allocaReg}`);
      } else {
        let isInterfaceType = false;
        if (baseType && this.getInterface(baseType)) {
          isInterfaceType = true;
        }
        const isInlineObjectType = baseType && baseType.startsWith('{');
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
                types.push(this.tsTypeToLlvm(field.type));
                tsTypes.push(field.type);
              }
              this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
                objectMetadata: { keys, types, tsTypes }
              });
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
                types.push(this.tsTypeToLlvm(field.type));
                tsTypes.push(field.type);
              }
              this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
                objectMetadata: { keys, types, tsTypes },
                interfaceType: baseType
              });
              this.ctx.emit(`${allocaReg} = alloca i8*`);
              this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
              return;
            }
          }
          this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local');
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else if (this.isUnionOfInterfaceTypes(baseType)) {
          this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local');
          this.ctx.emit(`${allocaReg} = alloca i8*`);
          this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        } else {
          this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
          this.ctx.emit(`${allocaReg} = alloca double`);
          this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        }
      }
      return;
    }

    if (stmt.declaredType) {
      if (stmt.declaredType === 'string[]') {
        this.ctx.expectedArrayElementType = 'string';
      } else if (stmt.declaredType === 'number[]' || stmt.declaredType === 'boolean[]') {
        this.ctx.expectedArrayElementType = 'number';
      } else if (stmt.declaredType.endsWith('[]')) {
        this.ctx.expectedArrayElementType = 'pointer';
      }
    }

    const isString = this.ctx.isStringExpression(stmt.value);
    let isStringArray = this.ctx.isStringArrayExpression(stmt.value);
    if (!isStringArray && stmt.declaredType === 'string[]') {
      isStringArray = true;
    }
    let isObjectArray = this.ctx.isObjectArrayExpression(stmt.value);
    if (!isObjectArray && stmt.declaredType && stmt.declaredType.endsWith('[]') &&
        stmt.declaredType !== 'string[]' && stmt.declaredType !== 'number[]' && stmt.declaredType !== 'boolean[]') {
      isObjectArray = true;
    }
    const isArray = !isStringArray && !isObjectArray && this.ctx.isArrayExpression(stmt.value);
    const isJSONObject = this.ctx.isJSONParseExpression(stmt.value);
    const isObject = !isJSONObject && this.ctx.isObjectExpression(stmt.value);
    const isMap = this.ctx.isMapExpression(stmt.value);
    const isSet = this.ctx.isSetExpression(stmt.value);
    const isRegex = this.ctx.isRegexExpression(stmt.value);
    const isPromise = this.ctx.isPromiseExpression(stmt.value);
    const isAwait = this.ctx.isAwaitExpression(stmt.value);
    const isClassInstance = !isPromise && this.ctx.isClassInstanceExpression(stmt.value);
    const isResponse = this.ctx.isResponseExpression(stmt.value);
    const typedJsonInterface = this.ctx.getTypedJsonInterface(stmt.value);
    const functionInterfaceReturn = this.ctx.getFunctionCallInterfaceReturn(stmt.value);
    const methodInterfaceReturn = this.ctx.getMethodCallInterfaceReturn(stmt.value);
    const methodArrayReturn = this.ctx.getMethodCallArrayReturn(stmt.value);
    const memberAccessInterfaceType = this.getMemberAccessInterfaceType(stmt.value);
    const mapGetInterfaceType = this.getMapGetInterfaceType(stmt.value);
    const declaredInterfaceType = this.getDeclaredInterfaceType(stmt);

    if (declaredInterfaceType) {
      this.allocateDeclaredInterface(stmt, params, declaredInterfaceType);
    } else if (mapGetInterfaceType) {
      this.allocateMapGetInterface(stmt, params, mapGetInterfaceType);
    } else if (functionInterfaceReturn) {
      this.allocateFunctionInterfaceReturn(stmt, params, functionInterfaceReturn);
    } else if (methodInterfaceReturn) {
      this.allocateMethodInterfaceReturn(stmt, params, methodInterfaceReturn);
    } else if (methodArrayReturn) {
      this.allocateMethodArrayReturn(stmt, params, methodArrayReturn);
    } else if (memberAccessInterfaceType) {
      this.allocateMemberAccessInterface(stmt, params, memberAccessInterfaceType);
    } else if (isAwait) {
      this.allocateAwaitResult(stmt, params);
    } else if (isPromise) {
      this.allocatePromise(stmt, params);
    } else if (isClassInstance) {
      this.allocateClassInstance(stmt, params);
    } else if (typedJsonInterface) {
      this.allocateTypedJsonInterface(stmt, params, typedJsonInterface);
    } else if (isResponse) {
      this.allocateResponse(stmt, params);
    } else if (isJSONObject) {
      this.allocateJSONObject(stmt, params);
    } else if (isObject) {
      this.allocateObject(stmt, params);
    } else if (isMap) {
      this.allocateMap(stmt, params);
    } else if (isSet) {
      this.allocateSet(stmt, params);
    } else if (isStringArray) {
      this.allocateStringArray(stmt, params);
    } else if (isObjectArray) {
      this.allocateObjectArray(stmt, params);
    } else if (isArray) {
      this.allocateArray(stmt, params);
    } else if (isRegex) {
      this.allocateRegex(stmt, params);
    } else if (isString) {
      this.allocateString(stmt, params);
    } else if (stmt.value && stmt.value.type === 'arrow_function') {
      this.allocateArrowFunction(stmt, params);
    } else {
      const indexedObjectType = this.getIndexedObjectArrayType(stmt.value);
      if (indexedObjectType) {
        this.allocateIndexedObjectArray(stmt, params, indexedObjectType);
      } else {
        const arrayMethodReturnType = this.getArrayMethodReturnType(stmt.value);
        if (arrayMethodReturnType) {
          this.allocateArrayMethodReturn(stmt, params, arrayMethodReturnType);
        } else if (this.isPointerOrExpression(stmt.value)) {
          this.allocatePointer(stmt, params);
        } else if (this.isNullLiteral(stmt.value)) {
          this.allocateNullPointer(stmt);
        } else {
          this.allocateNumeric(stmt, params);
        }
      }
    }

    this.ctx.expectedArrayElementType = null;
  }

  private allocateFunctionInterfaceReturn(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    if (interfaceName.startsWith('{')) {
      const inlineFields = this.parseInlineObjectType(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.tsTypeToLlvm(field.type));
          tsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.getInterface(interfaceName);
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.tsTypeToLlvm(field.type));
        tsTypes.push(field.type);
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys, types, tsTypes },
      interfaceType: interfaceName
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private allocateMethodInterfaceReturn(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    if (interfaceName.startsWith('{')) {
      const inlineFields = this.parseInlineObjectType(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.tsTypeToLlvm(field.type));
          tsTypes.push(field.type);
        }
      }
    } else {
      const interfaceDefResult = this.getInterface(interfaceName);
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(field.name));
        types.push(this.tsTypeToLlvm(field.type));
        tsTypes.push(field.type);
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys, types, tsTypes },
      interfaceType: interfaceName
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private allocateMethodArrayReturn(stmt: VariableDeclaration, params: string[], arrayInfo: { elementType: string; fields: { name: string; type: string }[] }): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const elementKeys: string[] = [];
    const elementTypes: string[] = [];
    const elementTsTypes: string[] = [];

    for (let i = 0; i < arrayInfo.fields.length; i++) {
      const field = arrayInfo.fields[i] as { name: string; type: string };
      elementKeys.push(field.name);
      elementTsTypes.push(field.type);
      if (field.type === 'string') {
        elementTypes.push('i8*');
      } else if (field.type === 'number') {
        elementTypes.push('double');
      } else if (field.type === 'boolean') {
        elementTypes.push('i32');
      } else {
        elementTypes.push('i8*');
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, '%ObjectArray*', SymbolKind.ObjectArray, 'local');
    this.ctx.symbolTable.setObjectArrayMetadata(stmt.name, {
      elementInterfaceName: arrayInfo.elementType,
      elementKeys,
      elementTypes,
      elementTsTypes
    });
    this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
    const arrPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %ObjectArray* ${arrPtr}, %ObjectArray** ${allocaReg}`);
  }

  private getDeclaredInterfaceType(stmt: VariableDeclaration): string | null {
    if (stmt.value?.type === 'type_assertion') {
      const assertionNode = stmt.value as TypeAssertionNode;
      const assertedType = assertionNode.assertedType;
      if (assertedType.startsWith('{')) {
        return assertedType;
      }
      const interfaceDefResult = this.getInterface(assertedType);
      if (interfaceDefResult) {
        return assertedType;
      }
    }
    if (!stmt.declaredType) return null;
    if (stmt.value?.type !== 'variable' && stmt.value?.type !== 'object') return null;
    const interfaceDefResult2 = this.getInterface(stmt.declaredType);
    if (!interfaceDefResult2) return null;
    return stmt.declaredType;
  }

  private parseInlineObjectType(typeStr: string): InterfaceField[] | null {
    if (!typeStr.startsWith('{') || !typeStr.endsWith('}')) {
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
      if (ch === '{' || ch === '(' || ch === '[' || ch === '<') {
        depth++;
      } else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') {
        depth--;
      } else if (ch === ';' && depth === 0) {
        const part = inner.slice(start, i).trim();
        if (part) {
          const colonIdx = part.indexOf(':');
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
      const colonIdx = lastPart.indexOf(':');
      if (colonIdx !== -1) {
        const name = lastPart.slice(0, colonIdx).trim();
        const fieldType = lastPart.slice(colonIdx + 1).trim();
        fields.push({ name, type: fieldType });
      }
    }
    return fields;
  }

  private allocateDeclaredInterface(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];

    if (interfaceName.startsWith('{')) {
      const inlineFields = this.parseInlineObjectType(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.tsTypeToLlvm(field.type));
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
        types.push(this.tsTypeToLlvm(field.type));
        tsTypes.push(field.type);
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys, types, tsTypes },
      interfaceType: interfaceName
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    this.ctx.currentDeclaredInterfaceType = interfaceName;
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.currentDeclaredInterfaceType = undefined;
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private getMapGetInterfaceType(expr: Expression): string | null {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getMapGetInterfaceType(expr);
    }
    if (expr?.type !== 'method_call') return null;
    const methodExpr = expr as MethodCallNode;
    if (methodExpr.method !== 'get') return null;

    let valueType: string | null = null;

    if (methodExpr.object?.type === 'variable') {
      const varObj = methodExpr.object as VariableNode;
      const mapName = varObj.name;
      if (!this.ctx.symbolTable.isMap(mapName)) return null;

      const mapMeta = this.ctx.symbolTable.getMapMetadata(mapName);
      if (!mapMeta) return null;
      if (mapMeta.keyType !== 'string') return null;

      valueType = mapMeta.valueType;
    } else if (methodExpr.object?.type === 'member_access') {
      const memberExpr = methodExpr.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (memberExprObjBase.type !== 'this') return null;
      if (!this.ctx.currentClassName) return null;

      const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
      if (!fieldInfoResult) return null;
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (!fieldInfo.tsType) return null;

      const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
      if (!mapMatch) return null;
      if (mapMatch[1] !== 'string') return null;

      valueType = mapMatch[2];
    }

    if (!valueType) return null;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return null;

    if (valueType.endsWith('[]')) {
      return valueType;
    }

    const interfaceDefResult = this.getInterface(valueType);
    if (!interfaceDefResult) return null;

    return valueType;
  }

  private allocateMapGetInterface(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    if (interfaceName.endsWith('[]')) {
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
      types.push(this.tsTypeToLlvm(field.type));
      tsTypes.push(field.type);
    }
    const llvmType = `%${interfaceName}*`;
    this.ctx.defineVariable(stmt.name, allocaReg, llvmType, SymbolKind.Object, 'local', {
      objectMetadata: { keys, types, tsTypes },
      interfaceType: interfaceName
    });
    this.ctx.emit(`${allocaReg} = alloca ${llvmType}`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${llvmType}`);
    this.ctx.emit(`store ${llvmType} ${typedPtr}, ${llvmType}* ${allocaReg}`);
  }

  private allocateMapGetArray(stmt: VariableDeclaration, params: string[], arrayType: string): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const elementType = arrayType.slice(0, -2);
    if (elementType === 'string') {
      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.StringArray, 'local');
    } else if (elementType === 'number' || elementType === 'boolean') {
      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Array, 'local');
    } else {
      const typeInfo = this.getTypeInfoForElementType(elementType);
      if (typeInfo) {
        this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.ObjectArray, 'local', {
          objectMetadata: { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes },
          interfaceType: elementType
        });
      } else {
        this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.ObjectArray, 'local', {
          interfaceType: elementType
        });
      }
    }
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private getMemberAccessInterfaceType(expr: Expression | null): string | null {
    if (!expr) return null;
    const exprBase = expr as ExprBase;
    if (exprBase.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    const objBase = memberExpr.object as ExprBase;
    if (objBase.type !== 'variable') return null;
    const varName = (memberExpr.object as VariableNode).name;
    if (!varName) return null;
    const symbol = this.ctx.symbolTable.lookup(varName);
    if (!symbol) return null;
    let objectInterfaceType: string | null = null;
    if (symbol.interfaceType) {
      objectInterfaceType = symbol.interfaceType;
    } else if (symbol.objectMetadata && symbol.objectMetadata.tsTypes) {
      const objMeta = symbol.objectMetadata;
      if (!objMeta.keys || !memberExpr.property) return null;
      const keyIdx = objMeta.keys.indexOf(memberExpr.property);
      if (keyIdx >= 0 && objMeta.tsTypes) {
        const propType = objMeta.tsTypes[keyIdx];
        if (propType && !propType.endsWith('[]') && propType !== 'string' && propType !== 'number' && propType !== 'boolean') {
          const iface = this.getInterface(propType);
          if (iface) return propType;
        }
      }
      return null;
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
        if (fieldType && !fieldType.endsWith('[]') && fieldType !== 'string' && fieldType !== 'number' && fieldType !== 'boolean') {
          const nestedIface = this.getInterface(fieldType);
          if (nestedIface) return fieldType;
        }
        return null;
      }
    }
    return null;
  }

  private allocateMemberAccessInterface(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const interfaceDefResult = this.getInterface(interfaceName);
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < interfaceDef.fields.length; i++) {
      const field = interfaceDef.fields[i] as { name: string; type: string };
      keys.push(stripOptional(field.name));
      types.push(this.tsTypeToLlvm(field.type));
      tsTypes.push(field.type);
    }
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys, types, tsTypes },
      interfaceType: interfaceName
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private allocateClassInstance(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    let className: string;

    const valueBase = stmt.value as ExprBase;
    if (valueBase.type === 'new') {
      const newExpr = stmt.value as NewNode;
      className = newExpr.className;
    } else if (valueBase.type === 'method_call') {
      const methodExpr = stmt.value as MethodCallNode;
      className = this.getMapGetClassName(methodExpr) || 'Unknown';
    } else {
      throw new Error(`Cannot allocate class instance for expression type: ${valueBase.type}`);
    }

    const fields = this.ctx.classGen.getClassFields(className);
    const ptrType = fields.length > 0 ? `%${className}_struct*` : 'i8*';

    this.ctx.defineVariable(stmt.name, allocaReg, ptrType, SymbolKind.Class, 'local', {
      classMetadata: { className }
    });
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
    if (methodExpr.method !== 'get') return null;
    const methodObjBase = methodExpr.object as ExprBase;
    if (methodObjBase.type === 'variable') {
      const varName = (methodExpr.object as VariableNode).name;
      if (this.ctx.symbolTable.isMap(varName)) {
        const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
        if (mapMeta && mapMeta.valueType) {
          return mapMeta.valueType;
        }
      }
    } else if (methodObjBase.type === 'member_access') {
      const memberExpr = methodExpr.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (memberExprObjBase.type === 'this' && this.ctx.currentClassName && this.ctx.classGen) {
        const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType) {
          const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
          if (mapMatch && mapMatch[2]) {
            return mapMatch[2];
          }
        }
      }
    }
    return null;
  }

  private allocatePromise(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, '%Promise*', SymbolKind.Object, 'local');
    this.ctx.emit(`${allocaReg} = alloca %Promise*`);

    const promisePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %Promise* ${promisePtr}, %Promise** ${allocaReg}`);
  }

  private allocateAwaitResult(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateTypedJsonInterface(stmt: VariableDeclaration, params: string[], interfaceName: string): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const structType = `%${interfaceName}*`;
    this.ctx.defineVariable(stmt.name, allocaReg, structType, SymbolKind.Object, 'local');
    this.ctx.emit(`${allocaReg} = alloca ${structType}`);

    const structPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store ${structType} ${structPtr}, ${structType}* ${allocaReg}`);
  }

  private allocateResponse(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, '%Response*', SymbolKind.Object, 'local');
    this.ctx.emit(`${allocaReg} = alloca %Response*`);

    const responsePtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %Response* ${responsePtr}, %Response** ${allocaReg}`);
  }

  private allocateJSONObject(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const interfaceName = this.ctx.getJSONParseInterface(stmt.value!);
    if (!interfaceName) {
      throw new Error(
        this.ctx.formatCodegenError(
          'JSON.parse() requires a type parameter. This should have been caught by the parser.\n' +
          'Use: JSON.parse<InterfaceName>(jsonString)'
        )
      );
    }

    if (interfaceName === 'number[]') {
      this.ctx.defineVariable(stmt.name, allocaReg, '%Array*', SymbolKind.Array, 'local');
      this.ctx.emit(`${allocaReg} = alloca %Array*`);
      const arrPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store %Array* ${arrPtr}, %Array** ${allocaReg}`);
      return;
    }

    const interfaceDefResult = this.getInterface(interfaceName);

    if (!interfaceDefResult) {
      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.JSON, 'local');
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
        types.push(this.tsTypeToLlvmJson(field.type));
      }

      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.JSON, 'local', {
        objectMetadata: { keys, types, tsTypes },
        interfaceType: interfaceName
      });

      this.ctx.emit(`${allocaReg} = alloca i8*`);
      const jsonPtr = this.ctx.generateExpression(stmt.value!, params);
      this.ctx.emit(`store i8* ${jsonPtr}, i8** ${allocaReg}`);
    }
  }

  private allocateObject(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const interfaceDefResult = stmt.declaredType
      ? this.getInterface(stmt.declaredType)
      : null;

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
        types.push(this.tsTypeToLlvm(field.type));
        tsTypes.push(field.type);
      }
    } else {
      const metadataResult = this.ctx.getObjectMetadata(stmt.value as ObjectNode);
      const metadata = metadataResult as ObjectMetadataResult;
      keys = metadata ? metadata.keys : [];
      types = metadata ? metadata.types : [];
    }

    const varMetadata: VariableMetadata = interfaceDefResult && stmt.declaredType
      ? { objectMetadata: { keys, types, tsTypes }, interfaceType: stmt.declaredType }
      : { objectMetadata: { keys, types, tsTypes }, interfaceType: undefined };
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', varMetadata);
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    if (interfaceDefResult) {
      this.ctx.currentDeclaredInterfaceType = stmt.declaredType;
    }
    const objExpr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.currentDeclaredInterfaceType = undefined;
    this.ctx.emit(`store i8* ${objExpr}, i8** ${allocaReg}`);
  }

  private allocateMap(stmt: VariableDeclaration, params: string[]): void {
    let mapTypeInfoResult = this.parseMapType(stmt.declaredType);

    if (!mapTypeInfoResult && stmt.value && stmt.value.type === 'map') {
      const mapNode = stmt.value as MapNode;
      if (mapNode.keyType && mapNode.valueType) {
        mapTypeInfoResult = { keyType: mapNode.keyType, valueType: mapNode.valueType };
      }
    }

    if (mapTypeInfoResult) {
      const mapTypeInfo = mapTypeInfoResult as MapTypeInfo;
      if (mapTypeInfo.keyType === 'string') {
        this.allocateStringMap(stmt, params, mapTypeInfo);
        return;
      }
    }
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, '%Map*', SymbolKind.Map, 'local');
    this.ctx.emit(`${allocaReg} = alloca %Map`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %Map, %Map* ${value}`);
    this.ctx.emit(`store %Map ${loadedMap}, %Map* ${allocaReg}`);
  }

  private allocateStringMap(stmt: VariableDeclaration, params: string[], mapTypeInfo: MapTypeInfo): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const llvmValueType = this.tsTypeToLlvm(mapTypeInfo.valueType);

    this.ctx.defineVariable(stmt.name, allocaReg, '%StringMap*', SymbolKind.Map, 'local', {
      mapMetadata: {
        keyType: 'string',
        valueType: mapTypeInfo.valueType,
        llvmKeyType: 'i8*',
        llvmValueType
      }
    });
    this.ctx.emit(`${allocaReg} = alloca %StringMap`);

    const declaredMapType = stmt.declaredType || `Map<${mapTypeInfo.keyType}, ${mapTypeInfo.valueType}>`;
    this.ctx.currentDeclaredMapType = declaredMapType;
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.currentDeclaredMapType = undefined;

    const loadedMap = this.ctx.nextTemp();
    this.ctx.emit(`${loadedMap} = load %StringMap, %StringMap* ${value}`);
    this.ctx.emit(`store %StringMap ${loadedMap}, %StringMap* ${allocaReg}`);
  }

  private parseMapType(declaredType: string | undefined): MapTypeInfo | null {
    if (!declaredType) return null;

    const match = declaredType.match(/^Map<\s*(\w+)\s*,\s*(\w+)\s*>$/);
    if (!match) return null;

    return {
      keyType: match[1],
      valueType: match[2]
    };
  }

  private parseSetType(declaredType: string | undefined): SetTypeInfo | null {
    if (!declaredType) return null;

    const match = declaredType.match(/^Set<\s*(\w+)\s*>$/);
    if (!match) return null;

    return {
      valueType: match[1]
    };
  }

  private allocateSet(stmt: VariableDeclaration, params: string[]): void {
    let setTypeInfoResult = this.parseSetType(stmt.declaredType);

    if (!setTypeInfoResult && stmt.value) {
      const valueBase = stmt.value as { type: string };
      if (valueBase.type === 'new') {
        const newExpr = stmt.value as { className: string; typeArgs?: string[] };
        if (newExpr.className === 'Set' && newExpr.typeArgs && newExpr.typeArgs.length > 0) {
          setTypeInfoResult = { valueType: newExpr.typeArgs[0] };
        }
      } else if (valueBase.type === 'set') {
        const setExpr = stmt.value as { valueType?: string };
        if (setExpr.valueType) {
          setTypeInfoResult = { valueType: setExpr.valueType };
        }
      }
    }

    if (setTypeInfoResult) {
      const setTypeInfo = setTypeInfoResult as SetTypeInfo;
      if (setTypeInfo.valueType === 'string') {
        this.allocateStringSet(stmt, params, setTypeInfo);
        return;
      }
    }
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, '%Set*', SymbolKind.Set, 'local');
    this.ctx.emit(`${allocaReg} = alloca %Set`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const loadedSet = this.ctx.nextTemp();
    this.ctx.emit(`${loadedSet} = load %Set, %Set* ${value}`);
    this.ctx.emit(`store %Set ${loadedSet}, %Set* ${allocaReg}`);
  }

  private allocateStringSet(stmt: VariableDeclaration, params: string[], setTypeInfo: SetTypeInfo): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    const llvmValueType = this.tsTypeToLlvm(setTypeInfo.valueType);

    this.ctx.defineVariable(stmt.name, allocaReg, '%StringSet*', SymbolKind.Set, 'local', {
      setMetadata: {
        valueType: 'string',
        llvmValueType
      }
    });
    this.ctx.emit(`${allocaReg} = alloca %StringSet`);

    this.ctx.currentDeclaredSetType = stmt.declaredType;
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.currentDeclaredSetType = undefined;

    const loadedSet = this.ctx.nextTemp();
    this.ctx.emit(`${loadedSet} = load %StringSet, %StringSet* ${value}`);
    this.ctx.emit(`store %StringSet ${loadedSet}, %StringSet* ${allocaReg}`);
  }

  private allocateStringArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local', { isPointerAlloca: true });
    this.ctx.emit(`${allocaReg} = alloca %StringArray*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType = this.ctx.getVariableType(value);
    let pointerValue = value;
    if (valueType === 'i32') {
      const ptrValue = this.ctx.nextTemp();
      this.ctx.emit(`${ptrValue} = inttoptr i32 ${value} to %StringArray*`);
      pointerValue = ptrValue;
    } else if (valueType !== '%StringArray*') {
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${pointerValue} to %StringArray*`);
      pointerValue = typedPtr;
    }
    this.ctx.emit(`store %StringArray* ${pointerValue}, %StringArray** ${allocaReg}`);
  }

  private allocateArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, '%Array*', SymbolKind.Array, 'local', { isPointerAlloca: true });
    this.ctx.emit(`${allocaReg} = alloca %Array*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType = this.ctx.getVariableType(value);
    let pointerValue = value;
    if (valueType !== '%Array*') {
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${pointerValue} to %Array*`);
      pointerValue = typedPtr;
    }
    this.ctx.emit(`store %Array* ${pointerValue}, %Array** ${allocaReg}`);
  }

  private allocateObjectArray(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);

    let elementType = this.ctx.getObjectArrayElementType(stmt.value!);
    if (!elementType && stmt.declaredType && stmt.declaredType.endsWith('[]')) {
      elementType = stmt.declaredType.slice(0, -2);
    }

    if (elementType) {
      const typeInfo = this.getTypeInfoForElementType(elementType);
      if (typeInfo) {
        this.ctx.defineVariable(stmt.name, allocaReg, '%ObjectArray*', SymbolKind.ObjectArray, 'local', {
          objectMetadata: {
            keys: typeInfo.keys,
            types: typeInfo.types,
            tsTypes: typeInfo.tsTypes
          },
          interfaceType: elementType
        });
        this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
        return;
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, '%ObjectArray*', SymbolKind.ObjectArray, 'local');
    this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store %ObjectArray* ${value}, %ObjectArray** ${allocaReg}`);
  }

  private allocateRegex(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Regex, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private allocateString(stmt: VariableDeclaration, params: string[]): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);

    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private isPointerOrExpression(expr: Expression | null): boolean {
    if (!expr) return false;
    const e = expr as ExprBase;
    if (e.type === 'binary') {
      const binExpr = expr as BinaryNode;
      if (binExpr.op === '||') {
        const rightBase = binExpr.right as ExprBase;
        if (rightBase.type === 'array') {
          const leftBase = binExpr.left as ExprBase;
          if (leftBase.type === 'member_access' || leftBase.type === 'method_call') {
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
        this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.ObjectArray, 'local', {
          objectMetadata: { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes },
          interfaceType: elementType
        });
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        const value = this.ctx.generateExpression(stmt.value!, params);
        this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
        return;
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.JSON, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const value = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${value}, i8** ${allocaReg}`);
  }

  private getPointerExpressionElementType(expr: Expression | null): string | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (e.type !== 'binary') return null;

    const binExpr = expr as BinaryNode;
    if (binExpr.op !== '||') return null;

    const leftBase = binExpr.left as ExprBase;
    if (leftBase.type !== 'member_access' && leftBase.type !== 'method_call') return null;

    return this.ctx.getObjectArrayElementType(binExpr.left);
  }

  private isNullLiteral(expr: Expression | null): boolean {
    if (!expr) return false;
    const e = expr as ExprBase;
    if (e.type === 'null' || e.type === 'undefined') return true;
    if (e.type === 'variable') {
      const v = expr as VariableNode;
      return v.name === 'null' || v.name === 'undefined';
    }
    return false;
  }

  private allocateNullPointer(stmt: VariableDeclaration): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);

    if (stmt.declaredType) {
      const baseType = stmt.declaredType.replace(/ \| undefined$/, '').replace(/ \| null$/, '').replace(/undefined \| /, '').replace(/null \| /, '').trim();
      if (baseType === 'number') {
        this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        return;
      }
      if (baseType === 'boolean') {
        this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double 0.0, double* ${allocaReg}`);
        return;
      }
      if (baseType === 'string') {
        this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        return;
      }
      if (baseType === 'string[]') {
        this.ctx.defineVariable(stmt.name, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        this.ctx.emit(`store %StringArray* null, %StringArray** ${allocaReg}`);
        return;
      }
      if (baseType === 'number[]' || baseType === 'boolean[]') {
        this.ctx.defineVariable(stmt.name, allocaReg, '%Array*', SymbolKind.Array, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %Array*`);
        this.ctx.emit(`store %Array* null, %Array** ${allocaReg}`);
        return;
      }
      if (baseType.startsWith('{')) {
        const inlineFields = this.parseInlineObjectType(baseType);
        if (inlineFields && inlineFields.length > 0) {
          const keys: string[] = [];
          const types: string[] = [];
          const tsTypes: string[] = [];
          for (let fi = 0; fi < inlineFields.length; fi++) {
            const field = inlineFields[fi] as { name: string; type: string };
            keys.push(stripOptional(field.name));
            types.push(this.tsTypeToLlvm(field.type));
            tsTypes.push(field.type);
          }
          this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
            objectMetadata: { keys, types, tsTypes }
          });
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
          types.push(this.tsTypeToLlvm(field.type));
          tsTypes.push(field.type);
        }
        this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
          objectMetadata: { keys, types, tsTypes },
          interfaceType: baseType
        });
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
        return;
      }
    }

    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.String, 'local');
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    this.ctx.emit(`store i8* null, i8** ${allocaReg}`);
  }

  private allocateNumeric(stmt: VariableDeclaration, params: string[]): void {
    const value = this.ctx.generateExpression(stmt.value!, params);
    const valueType: string | undefined = this.ctx.getVariableType(value);

    const isTreeSitterType = valueType === '%TSNode*' || valueType === '%TSTree*' || valueType === '%TSParser*' || valueType === '%TSLanguage*';
    if (isTreeSitterType) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(stmt.name, allocaReg, valueType, SymbolKind.Object, 'local');
      this.ctx.emit(`${allocaReg} = alloca double`);
      this.ctx.emit(`store double ${value}, double* ${allocaReg}`);
    } else if (valueType && valueType !== 'double' && valueType.indexOf('*') !== -1) {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(stmt.name, allocaReg, valueType, SymbolKind.Object, 'local');
      this.ctx.emit(`${allocaReg} = alloca ${valueType}`);
      this.ctx.emit(`store ${valueType} ${value}, ${valueType}* ${allocaReg}`);
    } else {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(stmt.name, allocaReg, 'double', SymbolKind.Number, 'local');
      this.ctx.emit(`${allocaReg} = alloca double`);
      if (valueType === 'i32') {
        const converted = this.ctx.nextTemp();
        this.ctx.emit(`${converted} = sitofp i32 ${value} to double`);
        this.ctx.emit(`store double ${converted}, double* ${allocaReg}`);
      } else {
        this.ctx.emit(`store double ${value}, double* ${allocaReg}`);
      }
    }
  }

  private allocateArrowFunction(stmt: VariableDeclaration, params: string[]): void {
    const scopeVarsResult = this.ctx.symbolTable.getScopeVarsArraysForClosure();
    const scopeVarsTyped = scopeVarsResult as { names: string[]; types: string[] };
    const lambdaName = this.ctx.exprGen.arrowFunctionGen.generateArrowFunction(stmt.value, params, undefined, scopeVarsTyped.names, scopeVarsTyped.types);

    const closureInfoResult = this.ctx.exprGen.arrowFunctionGen.getClosureInfoForLambda(lambdaName);
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
        this.ctx.emit(`${valueReg} = load ${captureItem.llvmType}, ${captureItem.llvmType}* ${allocaReg}`);

        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${fieldPtr} = getelementptr ${closureInfo.envStructName}, ${closureInfo.envStructName}* ${envTypedReg}, i32 0, i32 ${i}`);

        this.ctx.emit(`store ${captureItem.llvmType} ${valueReg}, ${captureItem.llvmType}* ${fieldPtr}`);
      }

      this.ctx.defineVariable(stmt.name, envTypedReg, 'i8*', SymbolKind.Closure, 'local', {
        closureMetadata: {
          lambdaName,
          envStructName: closureInfo.envStructName,
          envPtrRegister: envMemReg,
          captures: captures
        }
      });
    } else {
      const allocaReg = this.ctx.nextAllocaReg(stmt.name);
      this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Closure, 'local', {
        closureMetadata: {
          lambdaName,
          envStructName: '',
          envPtrRegister: 'null',
          captures: []
        }
      });
    }
  }

  private getIndexedObjectArrayType(expr: Expression | null): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!expr) return null;
    const e = expr as ExprBase;
    if (e.type !== 'index_access') return null;

    const indexExpr = expr as IndexAccessNode;
    const idxObjBase = indexExpr.object as ExprBase;

    if (idxObjBase.type === 'variable') {
      const varName = (indexExpr.object as VariableNode).name;
      const symbol = this.ctx.symbolTable.lookup(varName);
      if (symbol?.interfaceType) {
        return this.getTypeInfoForElementType(symbol.interfaceType);
      }
      if (symbol?.objectArrayMetadata) {
        const objArrayMeta = symbol.objectArrayMetadata;
        return {
          keys: objArrayMeta.elementKeys,
          types: objArrayMeta.elementTypes,
          tsTypes: objArrayMeta.elementTsTypes || []
        };
      }
      if (symbol?.objectMetadata?.tsTypes) {
        const objMeta = symbol.objectMetadata;
        const tsTypes = objMeta.tsTypes as string[];
        if (tsTypes.length > 0) {
          const firstType = tsTypes[0];
          if (firstType && firstType.endsWith('[]')) {
            const elementType = firstType.slice(0, -2);
            return this.getTypeInfoForElementType(elementType);
          }
          return {
            keys: objMeta.keys as string[],
            types: objMeta.types as string[],
            tsTypes: tsTypes
          };
        }
      }
      const objectMeta = this.ctx.symbolTable.getObjectInfo(varName) as ObjectMetadata;
      if (objectMeta && objectMeta.keys && objectMeta.types && objectMeta.tsTypes) {
        return {
          keys: objectMeta.keys as string[],
          types: objectMeta.types as string[],
          tsTypes: objectMeta.tsTypes as string[]
        };
      }
      return null;
    }

    if (idxObjBase.type === 'method_call') {
      const methodCall = indexExpr.object as MethodCallNode;
      const returnType = this.getMethodCallReturnType(methodCall);
      if (returnType && returnType.endsWith('[]')) {
        const elementType = returnType.slice(0, -2).trim();
        return this.getTypeInfoForElementType(elementType);
      }
      return null;
    }

    if (idxObjBase.type !== 'member_access') return null;

    const memberAccess = indexExpr.object as { type: string; object: Expression; property: string };
    const propertyName = memberAccess.property;

    const memberObjBase = memberAccess.object as ExprBase;
    if (memberObjBase.type === 'variable') {
      const varName = (memberAccess.object as VariableNode).name;
      const objectMeta = this.ctx.symbolTable.getObjectInfo(varName) as ObjectMetadata;
      if (!objectMeta) return null;

      const propIndex = objectMeta.keys.indexOf(propertyName);
      if (propIndex === -1) return null;

      const objMetaTsTypes = objectMeta.tsTypes as string[];
      const propTsType = objMetaTsTypes[propIndex];
      if (!propTsType) return null;

      const arrayMatch = propTsType.match(/^(.+)\[\]$/);
      if (!arrayMatch) return null;

      const elementType = arrayMatch[1];
      return this.getTypeInfoForElementType(elementType);
    }

    if (memberObjBase.type === 'member_access' || memberObjBase.type === 'this') {
      const memberAccessTyped = memberAccess as { type: string; object: Expression; property: string };
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

    const arrayMatch = fieldType.match(/^(.+)\[\]$/);
    if (!arrayMatch) return null;

    return arrayMatch[1];
  }

  private resolveMemberAccessObjectType(expr: Expression): string | null {
    const e = expr as ExprBase;
    if (e.type === 'this') {
      return this.ctx.currentClassName || null;
    }
    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      const symbol = this.ctx.symbolTable.lookup(varName);
      if (symbol?.objectMetadata?.tsTypes) {
        return symbol.llvmType;
      }
      return null;
    }
    if (e.type === 'member_access') {
      const member = expr as MemberAccessNode;
      const memberObjBase = member.object as ExprBase;
      if (memberObjBase.type === 'this') {
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

    const classes = this.ctx.ast.classes || [];
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
    if (!this.ctx.currentClassName) return null;
    return this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, fieldName);
  }

  private getTypeInfoForElementType(elementType: string): { keys: string[]; types: string[]; tsTypes: string[] } | null {

    if (elementType.startsWith('{')) {
      const inlineFields = this.parseInlineObjectType(elementType + '[]');
      if (inlineFields) {
        const keys: string[] = [];
        const types: string[] = [];
        const tsTypes: string[] = [];
        for (let i = 0; i < inlineFields.length; i++) {
          const field = inlineFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          types.push(this.tsTypeToLlvm(field.type));
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
        types.push(this.tsTypeToLlvm(field.type));
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

  private getUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[]; tsTypes: string[] } {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getUnionCommonFields(memberNames);
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
      types.push(this.tsTypeToLlvm(cf.type));
      tsTypes.push(cf.type);
    }

    return { keys, types, tsTypes };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.areTypesCompatible(type1, type2);
    }
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.normalizeType(type);
    }
    if (type.startsWith("'") && type.endsWith("'")) return 'string';
    if (type.startsWith('"') && type.endsWith('"')) return 'string';
    return type;
  }

  private allocateIndexedObjectArray(stmt: VariableDeclaration, params: string[], typeInfo: UnionCommonFields): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes }
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }

  private tsTypeToLlvm(tsType: string): string {
    if (this.isEnumType(tsType)) {
      return 'double';
    }
    return tsTypeToLlvmUtil(tsType);
  }

  private tsTypeToLlvmJson(tsType: string): string {
    return tsTypeToLlvmJsonUtil(tsType);
  }

  private getArrayMethodReturnType(expr: Expression | null): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!expr) return null;
    if (this.ctx.typeResolver) {
      const result = this.ctx.typeResolver.resolveArrayMethodReturnType(expr);
      if (result) {
        return { keys: result.keys, types: result.types, tsTypes: result.tsTypes || [] };
      }
    }
    return null;
  }

  private allocateArrayMethodReturn(stmt: VariableDeclaration, params: string[], typeInfo: UnionCommonFields): void {
    const allocaReg = this.ctx.nextAllocaReg(stmt.name);
    this.ctx.defineVariable(stmt.name, allocaReg, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: { keys: typeInfo.keys, types: typeInfo.types, tsTypes: typeInfo.tsTypes }
    });
    this.ctx.emit(`${allocaReg} = alloca i8*`);
    const objPtr = this.ctx.generateExpression(stmt.value!, params);
    this.ctx.emit(`store i8* ${objPtr}, i8** ${allocaReg}`);
  }
}
