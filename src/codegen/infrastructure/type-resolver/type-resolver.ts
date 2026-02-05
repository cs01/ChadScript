import { AST, InterfaceDeclaration, InterfaceField, TypeAliasDeclaration, Expression, MemberAccessNode, VariableNode, IndexAccessNode, BinaryNode, FunctionNode, ClassNode, CommonField, FunctionParameter, MethodCallNode, StringNode } from '../../../ast/types.js';
import { SymbolTable, ObjectMetadata, SymbolKind } from '../symbol-table.js';
import type { TypeChecker } from '../../../typescript/type-checker.js';
import { FieldInfo, MapTypeInfo, SetTypeInfo, TypeGuardInfo, UnionCommonFields, ThisFieldMapInfo, ThisFieldSetInfo, ClassGeneratorLike } from './types.js';
import { ResolvedType, createResolvedType, parseTypeString, stripOptional, tsTypeToLlvm as tsTypeToLlvmUtil, tsTypeToLlvmJson as tsTypeToLlvmJsonUtil } from '../type-system.js';

interface ExprBase { type: string; }

export interface TypeResolverContext {
  ast?: AST;
  symbolTable: SymbolTable;
  typeChecker?: TypeChecker | null;
  currentClassName?: string | null;
  currentFunction?: string | null;
  classGen?: ClassGeneratorLike;
}

export class TypeResolver {
  private interfaceCache = new Map<string, InterfaceDeclaration | null>();
  private classCache = new Map<string, ClassNode | null>();

  constructor(private ctx: TypeResolverContext) {}

  clearCaches(): void {
    this.interfaceCache.clear();
    this.classCache.clear();
  }

  getCompleteType(name: string): ResolvedType | null {
    // Check if we have a cached resolved type
    const cached = this.ctx.symbolTable.getResolvedType(name);
    if (cached) return cached;

    const symbol = this.ctx.symbolTable.lookup(name);
    if (!symbol) return null;

    let resolved: ResolvedType | null = null;

    if (symbol.interfaceType) {
      resolved = parseTypeString(symbol.interfaceType);
    } else if (symbol.mapMetadata) {
      const mapMeta = symbol.mapMetadata;
      const keyType = parseTypeString(mapMeta.keyType);
      const valueType = parseTypeString(mapMeta.valueType);
      resolved = createResolvedType('Map', {}, 0, [keyType, valueType]);
    } else if (symbol.setMetadata) {
      const setMeta = symbol.setMetadata;
      const valueType = parseTypeString(setMeta.valueType);
      resolved = createResolvedType('Set', {}, 0, [valueType]);
    } else if (symbol.objectArrayMetadata) {
      const objArrayMeta = symbol.objectArrayMetadata;
      resolved = createResolvedType(objArrayMeta.elementInterfaceName, {}, 1);
    } else if (symbol.arrayMetadata) {
      const arrMeta = symbol.arrayMetadata;
      resolved = createResolvedType(arrMeta.elementType, {}, 1);
    } else if (symbol.kind === SymbolKind.StringArray) {
      resolved = createResolvedType('string', {}, 1);
    } else if (symbol.kind === SymbolKind.BooleanArray) {
      resolved = createResolvedType('boolean', {}, 1);
    } else if (symbol.classMetadata) {
      const classMeta = symbol.classMetadata;
      resolved = createResolvedType(classMeta.className);
    } else {
      switch (symbol.llvmType) {
        case 'double':
          resolved = createResolvedType('number');
          break;
        case 'i8*':
          resolved = createResolvedType('string');
          break;
        case 'i1':
          resolved = createResolvedType('boolean');
          break;
        case '%Array*':
          resolved = createResolvedType('number', {}, 1);
          break;
        case '%StringArray*':
          resolved = createResolvedType('string', {}, 1);
          break;
        case '%Map*':
          resolved = createResolvedType('Map');
          break;
        case '%StringMap*':
          resolved = createResolvedType('Map', {}, 0, [createResolvedType('string'), createResolvedType('unknown')]);
          break;
        case '%Set*':
          resolved = createResolvedType('Set');
          break;
        case '%StringSet*':
          resolved = createResolvedType('Set', {}, 0, [createResolvedType('string')]);
          break;
        default:
          if (symbol.llvmType.startsWith('%') && symbol.llvmType.endsWith('*')) {
            const typeName = symbol.llvmType.slice(1, -1);
            if (typeName.endsWith('_struct')) {
              resolved = createResolvedType(typeName.slice(0, -7));
            } else {
              resolved = createResolvedType(typeName);
            }
          }
          break;
      }
    }

    // Cache the resolved type for future lookups
    if (resolved) {
      this.ctx.symbolTable.setResolvedType(name, resolved);
    }

    return resolved;
  }


  getInterface(name: string): InterfaceDeclaration | null {
    if (!name) {
      return null;
    }
    if (this.interfaceCache.has(name)) {
      return this.interfaceCache.get(name) || null;
    }
    if (!this.ctx.ast?.interfaces) {
      this.interfaceCache.set(name, null);
      return null;
    }
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i] as InterfaceDeclaration;
      if (!iface || !iface.name) {
        continue;
      }
      if (iface.name === name) {
        this.interfaceCache.set(name, iface);
        return iface;
      }
    }
    this.interfaceCache.set(name, null);
    return null;
  }

  getInterfaceMetadata(name: string): ObjectMetadata | null {
    const iface = this.getInterface(name);
    if (!iface) return null;
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i] as { name: string; type: string };
      keys.push(stripOptional(f.name));
      types.push(this.tsTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }
    return { keys, types, tsTypes };
  }

  getInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null {
    if (!interfaceName || !propName) {
      return null;
    }
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i] as { name: string; type: string };
      if (!f || !f.name) {
        continue;
      }
      if (f.name === propName) {
        return f;
      }
    }
    return null;
  }

  getInterfaceDefinition(interfaceName: string): { properties: { name: string; type: string }[] } | null {
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    const properties: { name: string; type: string }[] = [];
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i] as { name: string; type: string };
      properties.push({ name: f.name, type: f.type });
    }
    return { properties };
  }

  private resolveMemberAccessArrayType(memberAccess: MemberAccessNode): string | null {
    const objectType = this.resolveMemberAccessObjectType(memberAccess.object);
    if (!objectType) return null;

    const fieldProp = this.getInterfaceProperty(objectType, memberAccess.property);
    if (!fieldProp) return null;

    const arrayMatch = fieldProp.type.match(/^(.+)\[\]$/);
    if (!arrayMatch) return null;

    return arrayMatch[1];
  }

  private resolveMemberAccessObjectType(expr: Expression): string | null {
    const exprBase = expr as ExprBase;
    if (exprBase.type === 'this') {
      return this.ctx.currentClassName || null;
    }
    if (exprBase.type === 'member_access') {
      const member = expr as MemberAccessNode;
      const memberObjBase = member.object as ExprBase;
      if (memberObjBase.type === 'this') {
        if (this.ctx.currentClassName && this.ctx.classGen) {
          const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, member.property);
          const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
          if (fieldInfoResult && fieldInfo.tsType) {
            return fieldInfo.tsType;
          }
        }
        return null;
      }
      const objectType = this.resolveMemberAccessObjectType(member.object);
      if (objectType) {
        const fieldProp = this.getInterfaceProperty(objectType, member.property);
        if (fieldProp) {
          return fieldProp.type;
        }
      }
    }
    return null;
  }

  getTypeAlias(name: string): TypeAliasDeclaration | null {
    if (!name) return null;
    if (!this.ctx.ast?.typeAliases) return null;
    for (let i = 0; i < this.ctx.ast.typeAliases.length; i++) {
      const ta = this.ctx.ast.typeAliases[i] as TypeAliasDeclaration;
      if (!ta || !ta.name) {
        continue;
      }
      if (ta.name === name) {
        return ta;
      }
    }
    return null;
  }

  getFunction(name: string): FunctionNode | null {
    if (!name) return null;
    if (!this.ctx.ast?.functions) return null;
    for (let i = 0; i < this.ctx.ast.functions.length; i++) {
      const fn = this.ctx.ast.functions[i] as FunctionNode;
      if (!fn || !fn.name) {
        continue;
      }
      if (fn.name === name) {
        return fn;
      }
    }
    return null;
  }

  getFunctionType(functionName: string): { parameters: { name: string; type: string }[]; returnType: string } | null {
    const func = this.getFunction(functionName);
    if (!func) return null;
    const parameters: { name: string; type: string }[] = [];
    if (func.parameters) {
      for (let i = 0; i < func.parameters.length; i++) {
        const p = func.parameters[i] as FunctionParameter;
        parameters.push({
          name: p.name,
          type: p.type || 'number'
        });
      }
    } else if (func.params && func.paramTypes) {
      for (let i = 0; i < func.params.length; i++) {
        parameters.push({
          name: func.params[i],
          type: func.paramTypes[i] || 'number'
        });
      }
    }
    return { parameters, returnType: func.returnType || 'void' };
  }

  getClass(name: string): ClassNode | null {
    if (!name) {
      return null;
    }
    if (this.classCache.has(name)) {
      return this.classCache.get(name) || null;
    }
    if (!this.ctx.ast?.classes) {
      this.classCache.set(name, null);
      return null;
    }
    for (let i = 0; i < this.ctx.ast.classes.length; i++) {
      const cls = this.ctx.ast.classes[i] as ClassNode;
      if (!cls || !cls.name) {
        continue;
      }
      if (cls.name === name) {
        this.classCache.set(name, cls);
        return cls;
      }
    }
    this.classCache.set(name, null);
    return null;
  }

  getUnionCommonFields(memberNames: string[]): UnionCommonFields {
    const interfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < memberNames.length; i++) {
      const iface = this.getInterface(memberNames[i]);
      if (iface !== null) {
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
        const iface = interfaces[ii] as InterfaceDeclaration;
        let hasMatch = false;
        for (let jj = 0; jj < iface.fields.length; jj++) {
          const f = iface.fields[jj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            hasMatch = true;
            break;
          }
        }
        if (!hasMatch) {
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
      const f = commonFields[i] as CommonField;
      keys.push(stripOptional(f.name));
      types.push(this.tsTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }
    return { keys, types, tsTypes };
  }

  tsTypeToLlvm(tsType: string): string {
    if (this.isEnumType(tsType)) {
      return 'double';
    }
    return tsTypeToLlvmUtil(tsType);
  }

  tsTypeToLlvmJson(tsType: string): string {
    return tsTypeToLlvmJsonUtil(tsType);
  }

  getClassFieldInfo(className: string, fieldName: string): FieldInfo | null {
    if (!this.ctx.classGen) return null;
    return this.ctx.classGen.getFieldInfo(className, fieldName);
  }

  getClassFieldMapType(className: string, fieldName: string): MapTypeInfo | null {
    const fieldInfoResult = this.getClassFieldInfo(className, fieldName);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const match = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
    if (!match) return null;

    const keyType = match[1] as 'string' | 'number';
    const valueType = match[2];

    return {
      keyType,
      valueType,
      llvmKeyType: keyType === 'string' ? 'i8*' : 'double',
      llvmValueType: this.tsTypeToLlvm(valueType)
    };
  }

  getClassFieldSetType(className: string, fieldName: string): SetTypeInfo | null {
    const fieldInfoResult = this.getClassFieldInfo(className, fieldName);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const match = fieldInfo.tsType.match(/^Set<(\w+)>$/);
    if (!match) return null;

    const valueType = match[1] as 'string' | 'number';

    return {
      valueType,
      llvmValueType: valueType === 'string' ? 'i8*' : 'double'
    };
  }

  getMapGetInterfaceType(expr: Expression): string | null {
    if (expr?.type !== 'method_call') return null;
    const methodCall = expr as MethodCallNode;
    if (methodCall.method !== 'get') return null;

    let valueType: string | null = null;

    if (methodCall.object?.type === 'variable') {
      const mapName = (methodCall.object as VariableNode).name;
      if (!this.ctx.symbolTable.isMap(mapName)) return null;

      const mapMeta = this.ctx.symbolTable.getMapMetadata(mapName);
      if (!mapMeta) return null;
      if (mapMeta.keyType !== 'string') return null;

      valueType = mapMeta.valueType;
    } else if (methodCall.object?.type === 'member_access') {
      const memberExpr = methodCall.object as MemberAccessNode;
      const memberExprObjBase = memberExpr.object as ExprBase;
      if (memberExprObjBase.type !== 'this') return null;
      if (!this.ctx.currentClassName) return null;

      const mapType = this.getClassFieldMapType(this.ctx.currentClassName, memberExpr.property);
      if (!mapType) return null;
      if (mapType.keyType !== 'string') return null;

      valueType = mapType.valueType;
    }

    if (!valueType) return null;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return null;

    if (valueType.endsWith('[]')) {
      return valueType;
    }

    const interfaceDef = this.getInterface(valueType);
    if (!interfaceDef) return null;

    return valueType;
  }

  resolveIndexedAccessType(expr: IndexAccessNode): ObjectMetadata | null {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== 'member_access') return null;

    const memberAccess = expr.object as MemberAccessNode;
    const propertyName = memberAccess.property;

    let objectMeta: ObjectMetadata | undefined;

    const memberAccessObjBase = memberAccess.object as ExprBase;
    if (memberAccessObjBase.type === 'variable') {
      const varName = (memberAccess.object as VariableNode).name;
      objectMeta = this.ctx.symbolTable.getObjectInfo(varName);
    }

    if (!objectMeta) return null;
    const objMeta = objectMeta as ObjectMetadata;

    const propIndex = objMeta.keys.indexOf(propertyName);
    if (propIndex === -1) return null;

    const tsTypesArr = objMeta.tsTypes as string[];
    const propTsType = tsTypesArr[propIndex];
    if (!propTsType) return null;

    const arrayMatch = propTsType.match(/^(.+)\[\]$/);
    if (!arrayMatch) return null;

    const elementType = arrayMatch[1];
    return this.getInterfaceMetadata(elementType);
  }

  detectTypeGuard(condition: Expression): TypeGuardInfo | null {
    if (!condition) return null;
    if (condition.type !== 'binary') return null;

    const binary = condition as BinaryNode;
    if (binary.op !== '===' && binary.op !== '==') return null;
    if (!binary.left || !binary.right) return null;

    const leftBase = binary.left as ExprBase;
    const rightBase = binary.right as ExprBase;
    if (!leftBase.type || !rightBase.type) return null;

    let memberAccessVar: MemberAccessNode | null = null;
    let literalValueVar: string | null = null;

    if (leftBase.type === 'member_access' && rightBase.type === 'string') {
      memberAccessVar = binary.left as MemberAccessNode;
      const stringNode = binary.right as StringNode;
      literalValueVar = stringNode.value;
    } else if (rightBase.type === 'member_access' && leftBase.type === 'string') {
      memberAccessVar = binary.right as MemberAccessNode;
      const stringNode = binary.left as StringNode;
      literalValueVar = stringNode.value;
    }

    if (!memberAccessVar || !literalValueVar) return null;
    const memberAccess = memberAccessVar as MemberAccessNode;
    const literalValue = literalValueVar as string;
    if (memberAccess.property !== 'type') return null;
    const memberAccessObjBase2 = memberAccess.object as ExprBase;
    if (memberAccessObjBase2.type !== 'variable') return null;

    const varName = (memberAccess.object as VariableNode).name;
    const symbol = this.ctx.symbolTable.lookup(varName);
    if (!symbol || !symbol.objectMetadata) return null;
    const objMeta = symbol.objectMetadata;

    const interfaceName = this.findInterfaceByDiscriminant(literalValue);
    if (!interfaceName) return null;

    const metadata = this.getInterfaceMetadata(interfaceName);
    if (!metadata) return null;

    const currentKeys = objMeta.keys;
    let isSubset = true;
    for (let ki = 0; ki < metadata.keys.length; ki++) {
      if (currentKeys.indexOf(metadata.keys[ki]) === -1) {
        isSubset = false;
        break;
      }
    }
    if (!isSubset) return null;

    return {
      varName,
      narrowedMetadata: metadata
    };
  }

  findInterfaceByDiscriminant(value: string, field: string = 'type'): string | null {
    if (!this.ctx.ast?.interfaces) return null;

    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i] as InterfaceDeclaration;
      const match = this.checkInterfaceForDiscriminant(
        iface.name,
        iface.fields,
        value,
        field
      );
      if (match) return match;
    }
    return null;
  }

  private checkInterfaceForDiscriminant(
    ifaceName: string,
    fields: InterfaceField[],
    value: string,
    field: string
  ): string | null {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      if (f.name === field) {
        if (f.type === `'${value}'` || f.type === `"${value}"`) {
          return ifaceName;
        }
      }
    }
    return null;
  }

  areTypesCompatible(type1: string, type2: string): boolean {
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  normalizeType(typeStr: string): string {
    if (typeStr.startsWith("'") && typeStr.endsWith("'")) return 'string';
    if (typeStr.startsWith('"') && typeStr.endsWith('"')) return 'string';
    return typeStr;
  }

  isEnumType(typeName: string): boolean {
    if (!this.ctx.ast || !this.ctx.ast.enums) return false;
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

  getThisFieldMapType(expr: Expression): ThisFieldMapInfo | null {
    const exprBase = expr as ExprBase;
    if (exprBase.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;

    const memberExprObjBase = memberExpr.object as ExprBase;
    if (memberExprObjBase.type === 'this') {
      const fieldName = memberExpr.property;
      if (!this.ctx.currentClassName) return null;

      const fieldInfoResult = this.getClassFieldInfo(this.ctx.currentClassName, fieldName);
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (!fieldInfoResult || !fieldInfo.tsType) return null;

      const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
      if (!mapMatch) return null;

      return { fieldName, keyType: mapMatch[1], valueType: mapMatch[2] };
    }

    if (memberExprObjBase.type === 'member_access') {
      const nestedType = this.resolveNestedMemberType(memberExpr.object);
      if (!nestedType) return null;

      const ifaceDecl = this.getInterface(nestedType);
      if (ifaceDecl) {
        const iface = ifaceDecl as InterfaceDeclaration;
        let field: { name: string; type: string } | null = null;
        for (let i = 0; i < iface.fields.length; i++) {
          const f = iface.fields[i] as { name: string; type: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; type: string };
          const mapMatch = fieldTyped.type.match(/^Map<(\w+),\s*(.+)>$/);
          if (mapMatch) {
            return { fieldName: memberExpr.property, keyType: mapMatch[1], valueType: mapMatch[2] };
          }
        }
      }

      const classDecl = this.getClass(nestedType);
      if (classDecl) {
        const cls = classDecl as ClassNode;
        let field: { name: string; tsType: string } | null = null;
        for (let i = 0; i < cls.fields.length; i++) {
          const f = cls.fields[i] as { name: string; tsType: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; tsType: string };
          if (fieldTyped.tsType) {
            const mapMatch = fieldTyped.tsType.match(/^Map<(\w+),\s*(.+)>$/);
            if (mapMatch) {
              return { fieldName: memberExpr.property, keyType: mapMatch[1], valueType: mapMatch[2] };
            }
          }
        }
      }
    }

    return null;
  }

  private resolveNestedMemberType(expr: Expression): string | null {
    if (expr.type === 'this') {
      return this.ctx.currentClassName || null;
    }

    if (expr.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;

    const parentType = this.resolveNestedMemberType(memberExpr.object);
    if (!parentType) return null;

    const ifaceDecl = this.getInterface(parentType);
    if (ifaceDecl) {
      const iface = ifaceDecl as InterfaceDeclaration;
      let field: { name: string; type: string } | null = null;
      for (let i = 0; i < iface.fields.length; i++) {
        const f = iface.fields[i] as { name: string; type: string };
        if (f.name === memberExpr.property) {
          field = f;
          break;
        }
      }
      if (field) {
        const fieldTyped = field as { name: string; type: string };
        let fieldType = fieldTyped.type;
        if (fieldType.endsWith(' | null') || fieldType.endsWith(' | undefined')) {
          fieldType = fieldType.replace(/ \| null$/, '').replace(/ \| undefined$/, '');
        }
        if (fieldType.endsWith('?')) {
          fieldType = fieldType.slice(0, -1);
        }
        return fieldType;
      }
    }

    const classDecl = this.getClass(parentType);
    if (classDecl) {
      const cls = classDecl as ClassNode;
      let field: { name: string; tsType: string } | null = null;
      for (let i = 0; i < cls.fields.length; i++) {
        const f = cls.fields[i] as { name: string; tsType: string };
        if (f.name === memberExpr.property) {
          field = f;
          break;
        }
      }
      if (field) {
        const fieldTyped = field as { name: string; tsType: string };
        if (fieldTyped.tsType) {
          let fieldType = fieldTyped.tsType;
          if (fieldType.endsWith(' | null') || fieldType.endsWith(' | undefined')) {
            fieldType = fieldType.replace(/ \| null$/, '').replace(/ \| undefined$/, '');
          }
          if (fieldType.endsWith('?')) {
            fieldType = fieldType.slice(0, -1);
          }
          return fieldType;
        }
      }
    }

    return null;
  }

  getThisFieldSetType(expr: Expression): ThisFieldSetInfo | null {
    const exprBaseSet = expr as ExprBase;
    if (exprBaseSet.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    const memberExprObjBaseSet = memberExpr.object as ExprBase;
    if (memberExprObjBaseSet.type !== 'this') return null;

    const fieldName = memberExpr.property;
    if (!this.ctx.currentClassName) return null;

    const fieldInfoResult = this.getClassFieldInfo(this.ctx.currentClassName, fieldName);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const setMatch = fieldInfo.tsType.match(/^Set<(\w+)>$/);
    if (!setMatch) return null;

    return { fieldName, valueType: setMatch[1] };
  }

  getThisFieldMapKeyType(expr: Expression): string | null {
    const exprBaseKey = expr as ExprBase;
    if (exprBaseKey.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;

    const memberExprObjBaseKey = memberExpr.object as ExprBase;
    if (memberExprObjBaseKey.type === 'this') {
      if (!this.ctx.currentClassName) return null;
      const fieldInfoResult = this.getClassFieldInfo(this.ctx.currentClassName, memberExpr.property);
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (!fieldInfoResult || !fieldInfo.tsType) return null;

      const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
      if (!mapMatch) return null;
      return mapMatch[1];
    }

    if (memberExprObjBaseKey.type === 'member_access') {
      const nestedType = this.resolveNestedMemberType(memberExpr.object);
      if (!nestedType) return null;

      const ifaceDecl = this.getInterface(nestedType);
      if (ifaceDecl) {
        const iface = ifaceDecl as InterfaceDeclaration;
        let field: { name: string; type: string } | null = null;
        for (let i = 0; i < iface.fields.length; i++) {
          const f = iface.fields[i] as { name: string; type: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; type: string };
          const mapMatch = fieldTyped.type.match(/^Map<(\w+),\s*(.+)>$/);
          if (mapMatch) {
            return mapMatch[1];
          }
        }
      }

      const classDecl = this.getClass(nestedType);
      if (classDecl) {
        const cls = classDecl as ClassNode;
        let field: { name: string; tsType: string } | null = null;
        for (let i = 0; i < cls.fields.length; i++) {
          const f = cls.fields[i] as { name: string; tsType: string };
          if (f.name === memberExpr.property) {
            field = f;
            break;
          }
        }
        if (field) {
          const fieldTyped = field as { name: string; tsType: string };
          if (fieldTyped.tsType) {
            const mapMatch = fieldTyped.tsType.match(/^Map<(\w+),\s*(.+)>$/);
            if (mapMatch) {
              return mapMatch[1];
            }
          }
        }
      }
    }

    return null;
  }

  getThisFieldSetValueType(expr: Expression): string | null {
    const exprBaseSetVal = expr as ExprBase;
    if (exprBaseSetVal.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    const memberExprObjBaseSetVal = memberExpr.object as ExprBase;
    if (memberExprObjBaseSetVal.type !== 'this') return null;

    if (!this.ctx.currentClassName) return null;
    const fieldInfoResult = this.getClassFieldInfo(this.ctx.currentClassName, memberExpr.property);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const setMatch = fieldInfo.tsType.match(/^Set<(\w+)>$/);
    if (!setMatch) return null;
    return setMatch[1];
  }

  resolveArrayMethodReturnType(expr: Expression): ObjectMetadata | null {
    if (expr?.type !== 'method_call') return null;

    const methodCall = expr as MethodCallNode;
    const method = methodCall.method;

    if (method !== 'find') return null;

    const arrayExpr = methodCall.object as { type: string };

    if (arrayExpr.type === 'member_access') {
      const memberAccess = arrayExpr as MemberAccessNode;
      const propertyName = memberAccess.property;

      let objectMeta: ObjectMetadata | undefined;

      const memberObj = memberAccess.object as { type: string };
      if (memberObj.type === 'variable') {
        const varName = (memberObj as VariableNode).name;
        objectMeta = this.ctx.symbolTable.getObjectInfo(varName);
      } else if (memberObj.type === 'member_access' || memberObj.type === 'this') {
        const arrayType = this.resolveMemberAccessArrayType(memberAccess);
        if (arrayType) {
          return this.getInterfaceMetadata(arrayType);
        }
        return null;
      }

      if (!objectMeta) return null;
      const objMeta = objectMeta as ObjectMetadata;

      const propIndex = objMeta.keys.indexOf(propertyName);
      if (propIndex === -1) return null;

      const tsTypesArr = objMeta.tsTypes as string[];
      const propTsType = tsTypesArr[propIndex];
      if (!propTsType) return null;

      const arrayMatch = propTsType.match(/^(.+)\[\]$/);
      if (!arrayMatch) return null;

      const elementType = arrayMatch[1];
      return this.getInterfaceMetadata(elementType);
    }

    if (arrayExpr.type === 'variable') {
      const varExpr = arrayExpr as VariableNode;
      const varName = varExpr.name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return {
          keys: objArrayMeta.elementKeys,
          types: objArrayMeta.elementTypes,
          tsTypes: objArrayMeta.elementTsTypes
        };
      }
    }

    return null;
  }
}
