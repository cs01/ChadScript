import { AST, InterfaceDeclaration, InterfaceField, TypeAliasDeclaration, Expression, MemberAccessNode, VariableNode, IndexAccessNode, BinaryNode, FunctionNode, ClassNode } from '../../../ast/types.js';
import { SymbolTable, ObjectMetadata } from '../symbol-table.js';
import type { TypeChecker } from '../../../typescript/type-checker.js';
import { FieldInfo, MapTypeInfo, SetTypeInfo, TypeGuardInfo, UnionCommonFields, ThisFieldMapInfo, ThisFieldSetInfo, ClassGeneratorLike } from './types.js';

export interface TypeResolverContext {
  ast?: AST;
  symbolTable: SymbolTable;
  typeChecker?: TypeChecker | null;
  currentClassName?: string | null;
  currentFunction?: string | null;
  classGen?: ClassGeneratorLike;
}

export class TypeResolver {
  constructor(private ctx: TypeResolverContext) {}

  getInterface(name: string): InterfaceDeclaration | null {
    if (!this.ctx.ast?.interfaces) return null;
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  getInterfaceMetadata(name: string): ObjectMetadata | null {
    const iface = this.getInterface(name);
    if (!iface) return null;
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i];
      keys.push(f.name);
      types.push(this.tsTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }
    return { keys, types, tsTypes };
  }

  getInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null {
    const iface = this.getInterface(interfaceName);
    if (!iface) return null;
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i] as InterfaceField;
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
      const f = iface.fields[i] as InterfaceField;
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
    if (expr.type === 'this') {
      return this.ctx.currentClassName || null;
    }
    if (expr.type === 'member_access') {
      const member = expr as MemberAccessNode;
      if (member.object.type === 'this') {
        if (this.ctx.currentClassName && this.ctx.classGen) {
          const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, member.property);
          const fieldInfo = fieldInfoResult as FieldInfo;
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
    if (!this.ctx.ast?.typeAliases) return null;
    for (let i = 0; i < this.ctx.ast.typeAliases.length; i++) {
      const ta = this.ctx.ast.typeAliases[i] as TypeAliasDeclaration;
      if (ta.name === name) {
        return ta;
      }
    }
    return null;
  }

  getFunction(name: string): FunctionNode | null {
    if (!this.ctx.ast?.functions) return null;
    for (let i = 0; i < this.ctx.ast.functions.length; i++) {
      const fn = this.ctx.ast.functions[i] as FunctionNode;
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
        const p = func.parameters[i] as { name: string; type?: string };
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
    if (!this.ctx.ast?.classes) return null;
    for (let i = 0; i < this.ctx.ast.classes.length; i++) {
      const cls = this.ctx.ast.classes[i] as ClassNode;
      if (cls.name === name) {
        return cls;
      }
    }
    return null;
  }

  getUnionCommonFields(memberNames: string[]): UnionCommonFields {
    const interfacesRaw = memberNames
      .map(name => this.getInterface(name))
      .filter((i): i is InterfaceDeclaration => i !== null);
    const interfaces = interfacesRaw as InterfaceDeclaration[];

    if (interfaces.length === 0) {
      return { keys: [], types: [], tsTypes: [] };
    }

    const firstInterface = interfaces[0] as InterfaceDeclaration;
    const firstFields = firstInterface.fields;
    const commonFields: { name: string; type: string }[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as InterfaceField;
      const isCommon = interfaces.every(iface =>
        iface.fields.some(f => f.name === field.name && this.areTypesCompatible(f.type, field.type))
      );
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < commonFields.length; i++) {
      const f = commonFields[i];
      keys.push(f.name);
      types.push(this.tsTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }
    return { keys, types, tsTypes };
  }

  tsTypeToLlvm(tsType: string): string {
    if (tsType === 'string') return 'i8*';
    if (tsType === 'number') return 'double';
    if (tsType === 'boolean') return 'i1';
    if (tsType === 'string[]') return '%StringArray*';
    if (tsType === 'number[]' || tsType === 'boolean[]') return '%Array*';
    if (tsType.startsWith("'") || tsType.startsWith('"')) return 'i8*';
    return 'i8*';
  }

  tsTypeToLlvmJson(tsType: string): string {
    if (tsType === 'string') return 'i8*';
    if (tsType === 'number') return 'double';
    if (tsType === 'boolean') return 'double';
    if (tsType === 'string[]') return '%StringArray*';
    if (tsType === 'number[]') return '%Array*';
    return 'i8*';
  }

  getClassFieldInfo(className: string, fieldName: string): FieldInfo | null {
    if (!this.ctx.classGen) return null;
    return this.ctx.classGen.getFieldInfo(className, fieldName);
  }

  getClassFieldMapType(className: string, fieldName: string): MapTypeInfo | null {
    const fieldInfoResult = this.getClassFieldInfo(className, fieldName);
    const fieldInfo = fieldInfoResult as FieldInfo;
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
    const fieldInfo = fieldInfoResult as FieldInfo;
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
    if ((expr as { method: string }).method !== 'get') return null;

    const methodCall = expr as { object: Expression; method: string };
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
      if (memberExpr.object.type !== 'this') return null;
      if (!this.ctx.currentClassName) return null;

      const mapType = this.getClassFieldMapType(this.ctx.currentClassName, memberExpr.property);
      if (!mapType) return null;
      if (mapType.keyType !== 'string') return null;

      valueType = mapType.valueType;
    }

    if (!valueType) return null;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return null;

    const interfaceDef = this.getInterface(valueType);
    if (!interfaceDef) return null;

    return valueType;
  }

  resolveIndexedAccessType(expr: IndexAccessNode): ObjectMetadata | null {
    if (expr.object.type !== 'member_access') return null;

    const memberAccess = expr.object as MemberAccessNode;
    const propertyName = memberAccess.property;

    let objectMeta: ObjectMetadata | undefined;

    if (memberAccess.object.type === 'variable') {
      const varName = (memberAccess.object as VariableNode).name;
      objectMeta = this.ctx.symbolTable.getObjectInfo(varName);
    }

    if (!objectMeta) return null;

    const propIndex = objectMeta.keys.indexOf(propertyName);
    if (propIndex === -1) return null;

    const propTsType = objectMeta.tsTypes?.[propIndex];
    if (!propTsType) return null;

    const arrayMatch = propTsType.match(/^(.+)\[\]$/);
    if (!arrayMatch) return null;

    const elementType = arrayMatch[1];
    return this.getInterfaceMetadata(elementType);
  }

  detectTypeGuard(condition: Expression): TypeGuardInfo | null {
    if (condition.type !== 'binary') return null;

    const binary = condition as BinaryNode;
    if (binary.op !== '===' && binary.op !== '==') return null;

    let memberAccess: MemberAccessNode | null = null;
    let literalValue: string | null = null;

    if (binary.left.type === 'member_access' && binary.right.type === 'string') {
      memberAccess = binary.left as MemberAccessNode;
      literalValue = (binary.right as { type: 'string'; value: string }).value;
    } else if (binary.right.type === 'member_access' && binary.left.type === 'string') {
      memberAccess = binary.right as MemberAccessNode;
      literalValue = (binary.left as { type: 'string'; value: string }).value;
    }

    if (!memberAccess || !literalValue) return null;
    if (memberAccess.property !== 'type') return null;
    if (memberAccess.object.type !== 'variable') return null;

    const varName = (memberAccess.object as VariableNode).name;
    const symbol = this.ctx.symbolTable.lookup(varName);
    if (!symbol || !symbol.objectMetadata) return null;

    const interfaceName = this.findInterfaceByDiscriminant(literalValue);
    if (!interfaceName) return null;

    const metadata = this.getInterfaceMetadata(interfaceName);
    if (!metadata) return null;

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
    fields: { name: string; type: string }[],
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

  getThisFieldMapType(expr: Expression): ThisFieldMapInfo | null {
    if (expr.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    if (memberExpr.object.type !== 'this') return null;

    const fieldName = memberExpr.property;
    if (!this.ctx.currentClassName) return null;

    const fieldInfoResult = this.getClassFieldInfo(this.ctx.currentClassName, fieldName);
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
    if (!mapMatch) return null;

    return { fieldName, keyType: mapMatch[1], valueType: mapMatch[2] };
  }

  getThisFieldSetType(expr: Expression): ThisFieldSetInfo | null {
    if (expr.type !== 'member_access') return null;
    const memberExpr = expr as MemberAccessNode;
    if (memberExpr.object.type !== 'this') return null;

    const fieldName = memberExpr.property;
    if (!this.ctx.currentClassName) return null;

    const fieldInfoResult = this.getClassFieldInfo(this.ctx.currentClassName, fieldName);
    const fieldInfo = fieldInfoResult as FieldInfo;
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const setMatch = fieldInfo.tsType.match(/^Set<(\w+)>$/);
    if (!setMatch) return null;

    return { fieldName, valueType: setMatch[1] };
  }

  resolveArrayMethodReturnType(expr: Expression): ObjectMetadata | null {
    if (expr?.type !== 'method_call') return null;

    const methodCall = expr as { object: Expression; method: string; args: Expression[] };
    const method = methodCall.method;

    if (method !== 'find') return null;

    const arrayExpr = methodCall.object;

    if (arrayExpr.type === 'member_access') {
      const memberAccess = arrayExpr as MemberAccessNode;
      const propertyName = memberAccess.property;

      let objectMeta: ObjectMetadata | undefined;

      if (memberAccess.object.type === 'variable') {
        const varName = (memberAccess.object as VariableNode).name;
        objectMeta = this.ctx.symbolTable.getObjectInfo(varName);
      } else if (memberAccess.object.type === 'member_access' || memberAccess.object.type === 'this') {
        const arrayType = this.resolveMemberAccessArrayType(memberAccess);
        if (arrayType) {
          return this.getInterfaceMetadata(arrayType);
        }
        return null;
      }

      if (!objectMeta) return null;

      const propIndex = objectMeta.keys.indexOf(propertyName);
      if (propIndex === -1) return null;

      const propTsType = objectMeta.tsTypes?.[propIndex];
      if (!propTsType) return null;

      const arrayMatch = propTsType.match(/^(.+)\[\]$/);
      if (!arrayMatch) return null;

      const elementType = arrayMatch[1];
      return this.getInterfaceMetadata(elementType);
    }

    if (arrayExpr.type === 'variable') {
      const varName = (arrayExpr as VariableNode).name;
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
