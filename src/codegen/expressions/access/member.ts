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
  ClassField,
} from '../../../ast/types.js';
import type { SymbolTable } from '../../infrastructure/symbol-table.js';
import type { TypeChecker, TypeInfo } from '../../../typescript/type-checker.js';

interface PropertyTypeInfo {
  type: string;
  offset: number;
}

interface ClassGeneratorLike {
  getFieldInfo(className: string, fieldName: string): FieldInfo | null;
  getClassFields(className: string): FieldInfo[];
  thisPointer?: string | null;
  currentClassName?: string | null;
}

interface FieldInfo {
  index: number;
  type: string;
  tsType?: string;
}

interface StringGeneratorLike {
  createStringConstant(value: string): string;
}

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

interface JsonObjectMeta {
  keys: string[];
  types: string[];
  tsTypes?: string[];
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
  emit(instruction: string): void;
  symbolTable: SymbolTable;
  variableTypes: Map<string, string>;
  ast?: AST;
  typeChecker?: TypeChecker | null;
  thisPointer?: string | null;
  currentClassName?: string | null;
  currentFunction?: string | null;
  jsonObjectMetadata?: Map<string, JsonObjectMeta>;
  getVariableType(name: string): string | undefined;
  getVariableAlloca(name: string): string | undefined;
  syncStateToGenerators(): void;
  formatCodegenError(message: string, suggestion?: string): string;
  getObjectMetadata(obj: ObjectNode): ObjectMetadata;
  classGen: ClassGeneratorLike;
  stringGen: StringGeneratorLike;
  mapGen: MapGeneratorLike;
  setGen: SetGeneratorLike;
  responseGen: ResponseGeneratorLike;
  generateExpression(expr: Expression, params: string[]): string;
}

/**
 * MemberAccessGenerator
 *
 * Handles property access expressions:
 * - process.argv (special case)
 * - Class instance properties (this.field, instance.field)
 * - JSON object properties
 * - Regular object properties
 * - Array/String .length property
 * - Map/Set .size property
 * - TypeScript interface-based property access
 */
export class MemberAccessGenerator {
  constructor(private ctx: MemberAccessGeneratorContext) {}

  private getInterfaceFromAST(name: string): InterfaceInfo | null {
    const baseName = this.extractBaseTypeName(name);
    if (!this.ctx.ast?.interfaces) return null;
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === baseName) {
        const properties: InterfaceProperty[] = [];
        for (let j = 0; j < iface.fields.length; j++) {
          const field = iface.fields[j] as { name: string; type: string };
          properties.push({ name: field.name, type: field.type });
        }
        return { properties };
      }
    }
    const typeAliasResult = this.getTypeAliasCommonProperties(baseName);
    if (typeAliasResult) return typeAliasResult;
    return null;
  }

  private extractBaseTypeName(typeStr: string): string {
    const parts = typeStr.split('|');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part !== 'null' && part !== 'undefined') {
        return part;
      }
    }
    return typeStr;
  }

  private isTypeAlias(name: string): boolean {
    if (!this.ctx.ast?.typeAliases) return false;
    for (let i = 0; i < this.ctx.ast.typeAliases.length; i++) {
      const ta = this.ctx.ast.typeAliases[i] as { name: string };
      if (ta.name === name) {
        return true;
      }
    }
    return false;
  }

  private getTypeAliasCommonProperties(name: string): { properties: InterfaceProperty[] } | null {
    if (!this.ctx.ast?.typeAliases || !this.ctx.ast?.interfaces) return null;
    let typeAlias: { name: string; unionMembers: string[] } | null = null;
    for (let i = 0; i < this.ctx.ast.typeAliases.length; i++) {
      const ta = this.ctx.ast.typeAliases[i] as { name: string; unionMembers: string[] };
      if (ta.name === name) {
        typeAlias = ta;
        break;
      }
    }
    if (!typeAlias) return null;
    const typeAliasTyped = typeAlias as { name: string; unionMembers: string[] };
    if (typeAliasTyped.unionMembers.length === 0) return null;
    const memberInterfaces: { properties: InterfaceProperty[] }[] = [];
    for (let i = 0; i < typeAliasTyped.unionMembers.length; i++) {
      const memberName = typeAliasTyped.unionMembers[i];
      let found = null;
      for (let j = 0; j < this.ctx.ast.interfaces.length; j++) {
        const iface = this.ctx.ast.interfaces[j] as InterfaceDeclaration;
        if (iface.name === memberName) {
          const properties: InterfaceProperty[] = [];
          for (let k = 0; k < iface.fields.length; k++) {
            const f = iface.fields[k] as { name: string; type: string };
            properties.push({ name: f.name, type: f.type });
          }
          found = { properties };
          break;
        }
      }
      if (found) {
        memberInterfaces.push(found);
      }
    }
    if (memberInterfaces.length === 0) return null;
    const commonProps: InterfaceProperty[] = [];
    const firstMember = memberInterfaces[0] as { properties: InterfaceProperty[] };
    const firstProps = firstMember.properties;
    for (let i = 0; i < firstProps.length; i++) {
      const prop = firstProps[i] as InterfaceProperty;
      let existsInAll = true;
      let unifiedType = prop.type;
      for (let j = 1; j < memberInterfaces.length; j++) {
        const member = memberInterfaces[j] as { properties: InterfaceProperty[] };
        let foundInMember = false;
        for (let k = 0; k < member.properties.length; k++) {
          const mp = member.properties[k] as InterfaceProperty;
          if (mp.name === prop.name) {
            foundInMember = true;
            const otherType = mp.type;
            if (this.areTypesCompatible(unifiedType, otherType)) {
              unifiedType = this.unifyTypes(unifiedType, otherType);
            } else {
              foundInMember = false;
            }
            break;
          }
        }
        if (!foundInMember) {
          existsInAll = false;
          break;
        }
      }
      if (existsInAll) {
        commonProps.push({ name: prop.name, type: unifiedType });
      }
    }
    if (commonProps.length === 0) return null;
    return { properties: commonProps };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (type1 === type2) return true;
    const isStringLiteral1 = type1.startsWith("'") && type1.endsWith("'");
    const isStringLiteral2 = type2.startsWith("'") && type2.endsWith("'");
    if (isStringLiteral1 && isStringLiteral2) return true;
    if ((isStringLiteral1 && type2 === 'string') || (isStringLiteral2 && type1 === 'string')) return true;
    return false;
  }

  private unifyTypes(type1: string, type2: string): string {
    const isStringLiteral1 = type1.startsWith("'") && type1.endsWith("'");
    const isStringLiteral2 = type2.startsWith("'") && type2.endsWith("'");
    if (isStringLiteral1 || isStringLiteral2) return 'string';
    return type1;
  }

  generate(expr: MemberAccessNode, params: string[]): string {
    const enumResult = this.handleEnumMemberAccess(expr);
    if (enumResult !== null) return enumResult;

    // Try typed JSON struct access first
    const typedJsonResult = this.handleTypedJsonStructAccess(expr);
    if (typedJsonResult !== null) return typedJsonResult;

    // Handle process.argv special case
    if (this.isProcessArgv(expr)) {
      return this.handleProcessArgv();
    }

    // Handle class instance property access
    const classResult = this.handleClassPropertyAccess(expr, params);
    if (classResult !== null) return classResult;

    // Handle JSON object property access
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isJSON(expr.object.name)) {
      return this.handleJsonPropertyAccess(expr, params);
    }

    // Handle nested JSON object access
    if (expr.object.type === 'member_access') {
      const nestedResult = this.handleNestedJsonAccess(expr, params);
      if (nestedResult !== null) return nestedResult;

      // Handle chained interface property access (e.g., symbol.objectMetadata.keys)
      const chainedResult = this.handleChainedInterfaceAccess(expr, params);
      if (chainedResult !== null) return chainedResult;
    }

    // Handle indexed access to object array elements (e.g., arr[i].property)
    if (expr.object.type === 'index_access') {
      const indexResult = this.handleIndexAccessPropertyAccess(expr, params);
      if (indexResult !== null) return indexResult;
    }

    // Handle type assertion property access (e.g., (expr as Type).property)
    if (expr.object.type === 'type_assertion') {
      const assertResult = this.handleTypeAssertionPropertyAccess(expr, params);
      if (assertResult !== null) return assertResult;
    }

    // Handle method call result property access (e.g., map.get(key)?.property)
    if (expr.object.type === 'method_call') {
      const methodResult = this.handleMethodCallResultPropertyAccess(expr, params);
      if (methodResult !== null) return methodResult;
    }

    // Handle regular object property access
    const objResult = this.handleObjectPropertyAccess(expr, params);
    if (objResult !== null) return objResult;

    // Handle .length property
    if (expr.property === 'length') {
      return this.handleLengthProperty(expr, params);
    }

    // Handle .size property (Map/Set)
    if (expr.property === 'size') {
      const sizeResult = this.handleSizeProperty(expr, params);
      if (sizeResult !== null) return sizeResult;
    }

    // Handle Response properties
    const responseResult = this.handleResponseProperty(expr);
    if (responseResult !== null) return responseResult;

    // Handle TypeScript parameter property access
    return this.handleParameterPropertyAccess(expr, params);
  }

  private isProcessArgv(expr: MemberAccessNode): boolean {
    return expr.object.type === 'variable' &&
           (expr.object as VariableNode).name === 'process' &&
           expr.property === 'argv';
  }

  private handleEnumMemberAccess(expr: MemberAccessNode): string | null {
    if (expr.object.type !== 'variable') return null;

    const enumName = (expr.object as VariableNode).name;
    const memberName = expr.property;
    const enums = this.ctx.ast?.enums;
    if (!enums) return null;

    const enumDeclResult = enums.find((e: EnumDeclaration) => e.name === enumName);
    const enumDecl = enumDeclResult as EnumDeclaration;
    if (!enumDeclResult) return null;

    const memberResult = enumDecl.members.find((m: EnumMember) => m.name === memberName);
    const member = memberResult as EnumMember;
    if (!memberResult) {
      throw new Error(`Enum member '${memberName}' not found in enum '${enumName}'`);
    }

    const value = member.value;
    const result = this.ctx.nextTemp();
    const valueStr = String(value);
    const formattedValue = valueStr.indexOf('.') === -1 ? valueStr + '.0' : valueStr;
    this.ctx.emit(`${result} = fadd double ${formattedValue}, 0.0`);
    this.ctx.variableTypes.set(result, 'double');
    return result;
  }

  private handleTypedJsonStructAccess(expr: MemberAccessNode): string | null {
    if (expr.object.type !== 'variable') return null;

    const varName = (expr.object as VariableNode).name;
    const varType = this.ctx.getVariableType(varName);
    if (!varType || !varType.startsWith('%') || !varType.endsWith('*')) return null;
    if (varType === '%Response*' || varType.includes('Array') || varType.includes('Map') || varType.includes('Set')) {
      return null;
    }

    const structTypeName = varType.substring(1, varType.length - 1);

    const interfaceDefResult = this.getInterfaceFromAST(structTypeName);
    if (!interfaceDefResult) return null;
    const interfaceDef = interfaceDefResult as InterfaceInfo;

    let propIndex = -1;
    for (let i = 0; i < interfaceDef.properties.length; i++) {
      const p = interfaceDef.properties[i] as InterfaceProperty;
      if (p.name === expr.property) {
        propIndex = i;
        break;
      }
    }
    if (propIndex === -1) {
      throw new Error(`Property '${expr.property}' not found in interface ${structTypeName}`);
    }

    const propField = interfaceDef.properties[propIndex] as InterfaceProperty;
    const propType = propField.type;
    const varPtr = this.ctx.getVariableAlloca((expr.object as VariableNode).name);
    const structPtr = this.ctx.nextTemp();
    this.ctx.emit(`${structPtr} = load %${structTypeName}*, %${structTypeName}** ${varPtr}`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${structTypeName}, %${structTypeName}* ${structPtr}, i32 0, i32 ${propIndex}`);

    if (propType === 'string') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'i8*');
      return value;
    } else if (propType === 'number') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'double');
      return value;
    } else if (propType === 'boolean') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i1, i1* ${fieldPtr}`);
      const doubleValue = this.ctx.nextTemp();
      this.ctx.emit(`${doubleValue} = uitofp i1 ${value} to double`);
      this.ctx.variableTypes.set(doubleValue, 'double');
      return doubleValue;
    } else if (propType === 'string[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%StringArray*');
      return value;
    } else {
      let nestedTypeName = propType;
      if (nestedTypeName.endsWith('?')) {
        nestedTypeName = nestedTypeName.slice(0, -1);
      }
      if (nestedTypeName.includes(' | ')) {
        nestedTypeName = nestedTypeName.split(' | ')[0].trim();
      }
      const isTypeAlias = this.isTypeAlias(nestedTypeName);
      const nestedInterfaceResult = this.getInterfaceFromAST(nestedTypeName);
      if (nestedInterfaceResult) {
        const nestedInterface = nestedInterfaceResult as InterfaceInfo;
        const value = this.ctx.nextTemp();
        if (isTypeAlias) {
          this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
          this.ctx.variableTypes.set(value, 'i8*');
          const keys = nestedInterface.properties.map((p: InterfaceProperty) => p.name);
          const types = nestedInterface.properties.map((p: InterfaceProperty) => this.tsTypeToLlvm(p.type));
          const tsTypes = nestedInterface.properties.map((p: InterfaceProperty) => p.type);
          this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
          this.ctx.jsonObjectMetadata.set(value, { keys, types, tsTypes });
        } else {
          this.ctx.emit(`${value} = load %${nestedTypeName}*, %${nestedTypeName}** ${fieldPtr}`);
          this.ctx.variableTypes.set(value, `%${nestedTypeName}*`);
        }
        return value;
      }
    }
    return null;
  }

  private handleProcessArgv(): string {
    const sizePtr = this.ctx.nextTemp();
    this.ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = this.ctx.nextTemp();
    this.ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = this.ctx.nextTemp();
    this.ctx.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const argvStruct = this.ctx.nextTemp();
    this.ctx.emit(`${argvStruct} = bitcast i8* ${arrayMem} to %StringArray*`);

    const dataField = this.ctx.nextTemp();
    this.ctx.emit(`${dataField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 0`);
    const argvPtr = this.ctx.nextTemp();
    this.ctx.emit(`${argvPtr} = load i8**, i8*** @__argv`);
    this.ctx.emit(`store i8** ${argvPtr}, i8*** ${dataField}`);

    const lenField = this.ctx.nextTemp();
    this.ctx.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 1`);
    const argc = this.ctx.nextTemp();
    this.ctx.emit(`${argc} = load i32, i32* @__argc`);
    this.ctx.emit(`store i32 ${argc}, i32* ${lenField}`);

    const capField = this.ctx.nextTemp();
    this.ctx.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 2`);
    this.ctx.emit(`store i32 ${argc}, i32* ${capField}`);

    this.ctx.variableTypes.set(argvStruct, '%StringArray*');
    return argvStruct;
  }

  private handleClassPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    let className: string | null = null;
    let instancePtr: string | null = null;

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isClass((expr.object as VariableNode).name)) {
      const classMeta = this.ctx.symbolTable.getClassInfo((expr.object as VariableNode).name)!;
      className = classMeta.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if (expr.object.type === 'new') {
      const newExpr = expr.object as NewNode;
      className = newExpr.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if (expr.object.type === 'this') {
      const thisPtr = this.ctx.thisPointer || this.ctx.classGen.thisPointer;
      if (!thisPtr) {
        throw new Error('this.field accessed outside of class method or constructor');
      }
      instancePtr = thisPtr;
      className = this.ctx.currentClassName || this.ctx.classGen.currentClassName || null;
      if (!className) {
        const fieldName = expr.property;
        let classWithFieldResult: ClassNode | null = null;
        const astClasses = this.ctx.ast?.classes;
        const classes = astClasses || [];
        for (let ci = 0; ci < classes.length; ci++) {
          const c = classes[ci] as ClassNode;
          let hasField = false;
          for (let fi = 0; fi < c.fields.length; fi++) {
            const f = c.fields[fi] as { name: string };
            if (f.name === fieldName) {
              hasField = true;
              break;
            }
          }
          if (hasField) {
            classWithFieldResult = c;
            break;
          }
        }
        const classWithField = classWithFieldResult as ClassNode;
        if (classWithFieldResult) {
          className = classWithField.name;
        }
      }
    }

    if (!className || !instancePtr) return null;

    const fieldInfoResult = this.ctx.classGen.getFieldInfo(className, expr.property);
    const fields = this.ctx.classGen.getClassFields(className);

    if (fieldInfoResult) {
      const fieldInfo = fieldInfoResult as { index: number; type: string };
      const fieldPtr = this.ctx.nextTemp();
      if (fields.length > 0) {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`);
        return this.loadFieldValue(fieldPtr, fieldInfoResult);
      } else {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldInfo.index}`);
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
        return value;
      }
    } else if (fields.length === 0) {
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 0`);
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      return value;
    } else {
      throw new Error(`Field '${expr.property}' not found in class ${className}. Did you forget to declare it with a type annotation?`);
    }
  }

  private loadFieldValue(fieldPtr: string, fieldInfo: FieldInfo): string {
    if (fieldInfo.type === 'string') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      if (fieldInfo.tsType) {
        this.storeInterfaceMetadata(value, fieldInfo.tsType);
      }
      return value;
    } else if (fieldInfo.type === 'string[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%StringArray*');
      return value;
    } else if (fieldInfo.type.endsWith('[]')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%Array*');
      return value;
    } else if (fieldInfo.type === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = load i1, i1* ${fieldPtr}`);
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = uitofp i1 ${boolValue} to double`);
      this.ctx.variableTypes.set(value, 'double');
      return value;
    } else if (fieldInfo.tsType?.startsWith('Map<string,')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringMap*, %StringMap** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%StringMap*');
      return value;
    } else if (fieldInfo.tsType?.startsWith('Map<')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Map*, %Map** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%Map*');
      return value;
    } else if (fieldInfo.tsType === 'Set<string>') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringSet*, %StringSet** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%StringSet*');
      return value;
    } else if (fieldInfo.tsType?.startsWith('Set<')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Set*, %Set** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%Set*');
      return value;
    } else {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'double');
      if (fieldInfo.tsType) {
        this.storeInterfaceMetadata(value, fieldInfo.tsType);
      }
      return value;
    }
  }

  private storeInterfaceMetadata(register: string, tsType: string): void {
    const interfaceDefResult = this.ctx.ast?.interfaces?.find((iface: InterfaceDeclaration) => iface.name === tsType);
    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const f = interfaceDef.fields[i] as { name: string; type: string };
        keys.push(f.name);
        tsTypes.push(f.type);
        types.push(this.tsTypeToLlvm(f.type));
      }
      this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
      this.ctx.jsonObjectMetadata.set(register, { keys, types, tsTypes });
    }
  }

  private handleJsonPropertyAccess(expr: MemberAccessNode, params: string[]): string {
    const varName = (expr.object as VariableNode).name;
    const jsonMeta = this.ctx.symbolTable.getObjectInfo(varName);
    let tsType: string | undefined;
    if (jsonMeta?.tsTypes) {
      const propIdx = jsonMeta.keys.indexOf(expr.property);
      if (propIdx !== -1) {
        tsType = jsonMeta.tsTypes[propIdx];
      }
    }

    const jsonObjPtrPtr = this.ctx.getVariableAlloca(varName)!;
    const jsonObjPtr = this.ctx.nextTemp();
    this.ctx.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);

    this.ctx.syncStateToGenerators();
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);

    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

    if (tsType && !['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].includes(tsType)) {
      return this.handleNestedInterfaceField(fieldItem, tsType);
    }

    return this.extractJsonFieldValue(fieldItem);
  }

  private handleNestedInterfaceField(fieldItem: string, tsType: string): string {
    const nestedInterfaceDefResult = this.ctx.ast?.interfaces?.find((iface: InterfaceDeclaration) => iface.name === tsType);
    const nestedInterfaceDef = nestedInterfaceDefResult as InterfaceDeclaration;
    if (nestedInterfaceDefResult) {
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < nestedInterfaceDef.fields.length; i++) {
        const f = nestedInterfaceDef.fields[i] as { name: string; type: string };
        keys.push(f.name);
        tsTypes.push(f.type);
        types.push(this.tsTypeToLlvm(f.type));
      }
      this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
      this.ctx.jsonObjectMetadata.set(fieldItem, { keys, types, tsTypes });
    }
    this.ctx.variableTypes.set(fieldItem, 'i8*');
    return fieldItem;
  }

  private tsTypeToLlvm(t: string): string {
    if (t === 'string') return 'i8*';
    if (t === 'number') return 'double';
    if (t === 'boolean') return 'double';
    if (t === 'string[]') return '%StringArray*';
    if (t === 'number[]') return '%Array*';
    return 'i8*';
  }

  private extractJsonFieldValue(fieldItem: string): string {
    const fieldExists = this.ctx.nextTemp();
    this.ctx.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);

    const hasFieldLabel = this.ctx.nextLabel('json_has_field');
    const noFieldLabel = this.ctx.nextLabel('json_no_field');
    const fieldEndLabel = this.ctx.nextLabel('json_field_end');

    this.ctx.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);
    this.ctx.emit(`${hasFieldLabel}:`);

    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel('json_number');
    const stringLabel = this.ctx.nextLabel('json_string');

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
    const strAsInt = this.ctx.nextTemp();
    this.ctx.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${noFieldLabel}:`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${fieldEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ], [ 0, %${noFieldLabel} ]`);

    this.ctx.variableTypes.set(result, 'i32');
    return result;
  }

  private handleNestedJsonAccess(expr: MemberAccessNode, params: string[]): string | null {
    const innerResult = this.ctx.generateExpression(expr.object, params);
    const nestedMeta = this.ctx.jsonObjectMetadata?.get(innerResult);
    if (!nestedMeta) return null;

    this.ctx.syncStateToGenerators();
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);
    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${innerResult}, i8* ${fieldNameStr})`);

    const propIdx = nestedMeta.keys.indexOf(expr.property);
    const tsType = propIdx !== -1 ? nestedMeta.tsTypes?.[propIdx] : undefined;

    if (tsType && !['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].includes(tsType)) {
      return this.handleNestedInterfaceField(fieldItem, tsType);
    }

    return this.extractNestedJsonFieldValue(fieldItem);
  }

  private handleChainedInterfaceAccess(expr: MemberAccessNode, params: string[]): string | null {
    const innerPtr = this.ctx.generateExpression(expr.object, params);
    const innerType = this.ctx.variableTypes.get(innerPtr);

    if (innerType === 'i8*') {
      const metadata = this.ctx.jsonObjectMetadata?.get(innerPtr);
      if (metadata && metadata.keys && metadata.types) {
        const propIndex = metadata.keys.indexOf(expr.property);
        if (propIndex !== -1) {
          return this.accessObjectProperty(innerPtr, expr.property, metadata.keys, metadata.types, metadata.tsTypes);
        }
      }
      return null;
    }

    if (!innerType || !innerType.startsWith('%') || !innerType.endsWith('*')) {
      return null;
    }

    let innerInterfaceName = innerType.substring(1, innerType.length - 1);

    const innerInterfaceDefResult = this.getInterfaceFromAST(innerInterfaceName);
    if (!innerInterfaceDefResult) {
      return null;
    }
    const innerInterfaceDef = innerInterfaceDefResult as InterfaceInfo;

    let propIndex = -1;
    for (let i = 0; i < innerInterfaceDef.properties.length; i++) {
      const p = innerInterfaceDef.properties[i] as InterfaceProperty;
      if (p.name === expr.property) {
        propIndex = i;
        break;
      }
    }
    if (propIndex === -1) return null;

    const innerPropField = innerInterfaceDef.properties[propIndex] as InterfaceProperty;
    const propType = innerPropField.type;

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`);

    if (propType === 'string') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'i8*');
      return value;
    } else if (propType === 'number') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'double');
      return value;
    } else if (propType === 'boolean') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i1, i1* ${fieldPtr}`);
      const doubleValue = this.ctx.nextTemp();
      this.ctx.emit(`${doubleValue} = uitofp i1 ${value} to double`);
      this.ctx.variableTypes.set(doubleValue, 'double');
      return doubleValue;
    } else if (propType === 'string[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%StringArray*');
      return value;
    } else {
      let nestedTypeName = propType;
      if (nestedTypeName.endsWith('?')) {
        nestedTypeName = nestedTypeName.slice(0, -1);
      }
      const nestedInterfaceDefResult = this.getInterfaceFromAST(nestedTypeName);
      if (nestedInterfaceDefResult) {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load %${nestedTypeName}*, %${nestedTypeName}** ${fieldPtr}`);
        this.ctx.variableTypes.set(value, `%${nestedTypeName}*`);
        return value;
      }
      return null;
    }
  }

  private handleIndexAccessPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    const indexAccess = expr.object as IndexAccessNode;
    const elementInfo = this.getObjectArrayElementInfo(indexAccess.object);
    if (!elementInfo) return null;

    const arrayPtr = this.ctx.generateExpression(indexAccess.object, params);
    const indexDouble = this.ctx.generateExpression(indexAccess.index, params);

    const indexType = this.ctx.variableTypes.get(indexDouble);
    let index = indexDouble;
    if (indexType === 'double' || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    const structTypeFields = elementInfo.types.join(', ');
    const structType = `{ ${structTypeFields} }`;

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`);

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load ${structType}*, ${structType}** ${dataPtr}`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds ${structType}, ${structType}* ${data}, i32 ${index}`);

    const propIndex = elementInfo.keys.indexOf(expr.property);
    if (propIndex === -1) {
      throw new Error(`Unknown property: ${expr.property}. Available properties: ${elementInfo.keys.join(', ')}`);
    }

    const propType = elementInfo.types[propIndex];
    const propTsType = elementInfo.tsTypes[propIndex];
    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${elemPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.variableTypes.set(value, propType);

    if (propTsType && propTsType !== 'string' && propTsType !== 'number' && propTsType !== 'boolean') {
      const interfaceInfo = this.getKnownTypeProperties(propTsType);
      if (interfaceInfo) {
        this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
        this.ctx.jsonObjectMetadata.set(value, {
          keys: interfaceInfo.keys,
          types: interfaceInfo.types,
          tsTypes: interfaceInfo.tsTypes
        });
      }
    }

    return value;
  }

  private getKnownTypeProperties(typeName: string): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    let baseName = typeName;
    if (baseName.includes(' | ')) {
      const parts = baseName.split(' | ');
      baseName = parts[0].trim();
    }
    if (baseName === 'Expression') {
      return {
        keys: ['type'],
        types: ['i8*'],
        tsTypes: ['string']
      };
    }
    if (baseName === 'Statement') {
      return {
        keys: ['type'],
        types: ['i8*'],
        tsTypes: ['string']
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

  private getInterfaceInfo(interfaceName: string): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!this.ctx.ast || !this.ctx.ast.interfaces) {
      return null;
    }
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i];
      if (iface.name === interfaceName) {
        const keys: string[] = [];
        const types: string[] = [];
        const tsTypes: string[] = [];
        for (let j = 0; j < iface.fields.length; j++) {
          const f = iface.fields[j] as { name: string; type: string };
          keys.push(f.name);
          tsTypes.push(f.type);
          if (f.type === 'string') {
            types.push('i8*');
          } else if (f.type === 'number') {
            types.push('double');
          } else if (f.type === 'boolean') {
            types.push('i32');
          } else {
            types.push('i8*');
          }
        }
        return { keys, types, tsTypes };
      }
    }
    return null;
  }

  private getTypeAliasInfo(typeName: string): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    const typeAliasProps = this.getTypeAliasCommonProperties(typeName);
    if (!typeAliasProps) return null;
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < typeAliasProps.properties.length; i++) {
      const p = typeAliasProps.properties[i] as InterfaceProperty;
      keys.push(p.name);
      tsTypes.push(p.type);
      types.push(this.tsTypeToLlvm(p.type));
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
    if (expr.type === 'this') {
      const className = this.ctx.currentClassName || this.ctx.classGen.currentClassName;
      return className || null;
    }
    if (expr.type === 'variable') {
      const varName = (expr as VariableNode).name;
      const symbol = this.ctx.symbolTable.lookup(varName);
      if (symbol && symbol.objectMetadata) {
        return symbol.interfaceType || null;
      }
      return null;
    }
    if (expr.type === 'member_access') {
      const memberAccess = expr as MemberAccessNode;
      if (memberAccess.object.type === 'this') {
        const className = this.ctx.currentClassName || this.ctx.classGen.currentClassName;
        if (className) {
          const fieldInfoResult = this.ctx.classGen.getFieldInfo(className, memberAccess.property);
          const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
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

  private getObjectArrayElementInfo(arrayExpr: Expression): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (arrayExpr.type === 'member_access') {
      const memberAccess = arrayExpr as MemberAccessNode;
      const arrayType = this.resolveMemberAccessType(memberAccess);
      if (arrayType && arrayType.endsWith('[]')) {
        const elementType = arrayType.slice(0, -2);
        const interfaceInfo = this.getInterfaceInfo(elementType);
        if (interfaceInfo) {
          return interfaceInfo;
        }
      }
      if (memberAccess.object.type === 'variable') {
        const varName = (memberAccess.object as VariableNode).name;
        const propName = memberAccess.property;
        const paramType = this.getParameterTypeFromAST(varName);
        if (paramType) {
          const fieldType = this.getInterfaceFieldType(paramType, propName);
          if (fieldType && fieldType.endsWith('[]')) {
            const fields = this.parseInlineObjectType(fieldType);
            if (fields) {
              const keys: string[] = [];
              const types: string[] = [];
              const tsTypes: string[] = [];
              for (let j = 0; j < fields.length; j++) {
                const f = fields[j];
                keys.push(f.name);
                tsTypes.push(f.type);
                if (f.type === 'string') {
                  types.push('i8*');
                } else if (f.type === 'number') {
                  types.push('double');
                } else if (f.type === 'boolean') {
                  types.push('i32');
                } else {
                  types.push('i8*');
                }
              }
              return { keys, types, tsTypes };
            }
          }
        }
        const symbol = this.ctx.symbolTable.lookup(varName);
        if (symbol && symbol.objectMetadata && symbol.objectMetadata.tsTypes) {
          const objKeys = symbol.objectMetadata.keys;
          const objTsTypes = symbol.objectMetadata.tsTypes;
          const idx = objKeys.indexOf(propName);
          if (idx !== -1) {
            const fieldType = objTsTypes[idx];
            if (fieldType && fieldType.endsWith('[]')) {
              const fields = this.parseInlineObjectType(fieldType);
              if (fields) {
                const keys: string[] = [];
                const types: string[] = [];
                const tsTypes: string[] = [];
                for (let j = 0; j < fields.length; j++) {
                  const f = fields[j];
                  keys.push(f.name);
                  tsTypes.push(f.type);
                  if (f.type === 'string') {
                    types.push('i8*');
                  } else if (f.type === 'number') {
                    types.push('double');
                  } else if (f.type === 'boolean') {
                    types.push('i32');
                  } else {
                    types.push('i8*');
                  }
                }
                return { keys, types, tsTypes };
              }
            }
          }
        }
      }
    }
    if (arrayExpr.type === 'variable') {
      const varName = (arrayExpr as VariableNode).name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return { keys: objArrayMeta.elementKeys, types: objArrayMeta.elementTypes, tsTypes: objArrayMeta.elementTsTypes || [] };
      }
    }
    return null;
  }

  private parseInlineObjectType(type: string): { name: string; type: string }[] | null {
    if (!type.startsWith('{') || !type.endsWith('}[]')) {
      return null;
    }
    const inner = type.slice(1, type.length - 3).trim();
    const parts = inner.split(';');
    const fields: { name: string; type: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const name = part.slice(0, colonIdx).trim();
      const t = part.slice(colonIdx + 1).trim();
      fields.push({ name, type: t });
    }
    return fields.length > 0 ? fields : null;
  }

  private getParameterTypeFromAST(paramName: string): string | null {
    if (!this.ctx.ast || !this.ctx.currentFunction) {
      return null;
    }
    for (let i = 0; i < this.ctx.ast.functions.length; i++) {
      const fn = this.ctx.ast.functions[i];
      if (fn.name === this.ctx.currentFunction) {
        if (fn.parameters) {
          for (let j = 0; j < fn.parameters.length; j++) {
            const p = fn.parameters[j] as FunctionParameter;
            if (p.name === paramName && p.type) {
              return p.type;
            }
          }
        }
      }
    }
    for (let i = 0; i < this.ctx.ast.classes.length; i++) {
      const cls = this.ctx.ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        const method = cls.methods[j];
        if (method.name === this.ctx.currentFunction) {
          if (method.paramTypes) {
            for (let k = 0; k < method.params.length; k++) {
              if (method.params[k] === paramName && method.paramTypes[k]) {
                return method.paramTypes[k];
              }
            }
          }
        }
      }
    }
    return null;
  }

  private getInterfaceFieldType(interfaceName: string, fieldName: string): string | null {
    if (!this.ctx.ast || !this.ctx.ast.interfaces) {
      return null;
    }
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i];
      if (iface.name === interfaceName) {
        for (let j = 0; j < iface.fields.length; j++) {
          const f = iface.fields[j] as { name: string; type: string };
          if (f.name === fieldName) {
            return f.type;
          }
        }
      }
    }
    return null;
  }

  private extractNestedJsonFieldValue(fieldItem: string): string {
    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel('json_number');
    const stringLabel = this.ctx.nextLabel('json_string');
    const fieldEndLabel = this.ctx.nextLabel('json_field_end');

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
    const strAsInt = this.ctx.nextTemp();
    this.ctx.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${fieldEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ]`);

    this.ctx.variableTypes.set(result, 'i32');
    return result;
  }

  private handleObjectPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    let objPtr: string = '';
    let keys: string[] = [];
    let types: string[] = [];
    let tsTypes: string[] | undefined = undefined;

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isJSON((expr.object as VariableNode).name)) {
      return null;  // Already handled in handleJsonPropertyAccess
    } else if (expr.object.type === 'variable' && this.ctx.symbolTable.isObject((expr.object as VariableNode).name)) {
      const varName = (expr.object as VariableNode).name;
      const objMeta = this.ctx.symbolTable.getObjectInfo(varName);
      if (!objMeta) return null;
      keys = objMeta.keys;
      types = objMeta.types;
      tsTypes = objMeta.tsTypes;
      const objPtrPtr = this.ctx.getVariableAlloca(varName)!;
      objPtr = this.ctx.nextTemp();
      this.ctx.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);
    } else if (expr.object.type === 'object') {
      const metadataResult = this.ctx.getObjectMetadata(expr.object as ObjectNode);
      const metadata = metadataResult as ObjectMetadata;
      keys = metadata.keys;
      types = metadata.types;
      objPtr = this.ctx.generateExpression(expr.object, params);
    } else if (expr.object.type === 'method_call') {
      const result = this.handleMethodCallPropertyAccess(expr, params);
      if (result !== null) return result;
      return null;
    } else {
      return null;
    }

    if (keys.length === 0 || !objPtr) return null;

    const propIndex = keys.indexOf(expr.property);
    if (propIndex === -1) {
      const objDesc = expr.object.type === 'variable' ? (expr.object as VariableNode).name : 'literal';
      throw new Error(`Unknown property: ${expr.property} on object ${objDesc}. Available properties: ${keys.join(', ')}`);
    }

    const propType = types[propIndex];
    const propTsType = tsTypes ? tsTypes[propIndex] : undefined;
    const structType = `{ ${types.join(', ')} }`;

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.variableTypes.set(value, propType);

    if (propTsType && propTsType !== 'string' && propTsType !== 'number' && propTsType !== 'boolean') {
      const interfaceInfo = this.getKnownTypeProperties(propTsType);
      if (interfaceInfo) {
        this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
        this.ctx.jsonObjectMetadata.set(value, {
          keys: interfaceInfo.keys,
          types: interfaceInfo.types,
          tsTypes: interfaceInfo.tsTypes
        });
      }
    }

    return value;
  }

  private handleMethodCallPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    const methodCall = expr.object as MethodCallNode;
    if (methodCall.method !== 'parse') return null;
    if (methodCall.object.type !== 'variable') return null;
    if ((methodCall.object as VariableNode).name !== 'JSON') return null;

    this.ctx.syncStateToGenerators();
    const jsonObjPtr = this.ctx.generateExpression(expr.object, params);
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);

    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

    return this.extractJsonFieldValue(fieldItem);
  }

  private handleMethodCallResultPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    const methodCall = expr.object as MethodCallNode;

    if (methodCall.method !== 'get') return null;
    if (methodCall.object.type !== 'member_access') return null;

    const memberExpr = methodCall.object as MemberAccessNode;
    if (memberExpr.object.type !== 'this') return null;
    if (!this.ctx.classGen?.currentClassName) return null;

    const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.classGen.currentClassName, memberExpr.property);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
    if (!mapMatch) return null;

    const valueType = mapMatch[2];
    const interfaceDefResult = this.ctx.ast?.interfaces?.find((i: InterfaceDeclaration) => i.name === valueType);
    if (!interfaceDefResult) return null;
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;

    const objPtr = this.ctx.generateExpression(expr.object, params);

    let propIndex = -1;
    for (let i = 0; i < interfaceDef.fields.length; i++) {
      const f = interfaceDef.fields[i] as { name: string; type: string };
      if (f.name === expr.property) {
        propIndex = i;
        break;
      }
    }
    if (propIndex === -1) {
      const fieldNames: string[] = [];
      for (let i = 0; i < interfaceDef.fields.length; i++) {
        const field = interfaceDef.fields[i] as { name: string; type: string };
        fieldNames.push(field.name);
      }
      throw new Error(`Unknown property: ${expr.property} on interface ${valueType}. Available properties: ${fieldNames.join(', ')}`);
    }

    const propField = interfaceDef.fields[propIndex] as { name: string; type: string };
    const propType = this.tsTypeToLlvm(propField.type);
    const structTypes: string[] = [];
    for (let i = 0; i < interfaceDef.fields.length; i++) {
      const field = interfaceDef.fields[i] as { name: string; type: string };
      structTypes.push(this.tsTypeToLlvm(field.type));
    }
    const structType = `{ ${structTypes.join(', ')} }`;

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.variableTypes.set(value, propType);

    return value;
  }

  private handleLengthProperty(expr: MemberAccessNode, params: string[]): string {
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isNumberArray((expr.object as VariableNode).name)) {
      return this.getArrayLength(expr.object, params, '%Array');
    }

    if (this.isProcessArgvLength(expr)) {
      const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
      return this.getStringArrayLength(stringArrayPtr);
    }

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isStringArray((expr.object as VariableNode).name)) {
      const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
      return this.getStringArrayLength(stringArrayPtr);
    }

    if (expr.object.type === 'member_access') {
      const result = this.handleMemberAccessLength(expr, params);
      if (result !== null) return result;
    }

    return this.getStringLength(expr.object, params);
  }

  private isProcessArgvLength(expr: MemberAccessNode): boolean {
    if (expr.object.type !== 'member_access') return false;
    const innerAccess = expr.object as MemberAccessNode;
    return innerAccess.object.type === 'variable' &&
           (innerAccess.object as VariableNode).name === 'process' &&
           innerAccess.property === 'argv';
  }

  private getArrayLength(obj: Expression, params: string[], arrayType: string): string {
    const arrayPtr = this.ctx.generateExpression(obj, params);
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private getStringArrayLength(stringArrayPtr: string): string {
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private handleMemberAccessLength(expr: MemberAccessNode, params: string[]): string | null {
    if (expr.object.type !== 'member_access') return null;
    const innerAccess = expr.object as MemberAccessNode;

    if (innerAccess.object.type === 'variable' && this.ctx.symbolTable.isClass((innerAccess.object as VariableNode).name)) {
      const classMeta = this.ctx.symbolTable.getClassInfo((innerAccess.object as VariableNode).name)!;
      const fieldInfoResult = this.ctx.classGen.getFieldInfo(classMeta.className, innerAccess.property);
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (fieldInfoResult && fieldInfo.type === 'string[]') {
        const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
        return this.getStringArrayLength(stringArrayPtr);
      } else if (fieldInfoResult && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
        const arrayPtr = this.ctx.generateExpression(expr.object, params);
        return this.getArrayLengthFromPtr(arrayPtr, '%Array');
      }
    } else if (innerAccess.object.type === 'this') {
      const className = this.ctx.currentClassName || this.ctx.classGen.currentClassName;
      if (className) {
        const fieldInfoResult = this.ctx.classGen.getFieldInfo(className, innerAccess.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.type === 'string[]') {
          const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getStringArrayLength(stringArrayPtr);
        } else if (fieldInfoResult && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
          const arrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getArrayLengthFromPtr(arrayPtr, '%Array');
        }
      }
    }
    return null;
  }

  private getArrayLengthFromPtr(arrayPtr: string, arrayType: string): string {
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private getStringLength(obj: Expression, params: string[]): string {
    const objPtr = this.ctx.generateExpression(obj, params);
    const lenI64 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private handleSizeProperty(expr: MemberAccessNode, params: string[]): string | null {
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isMap((expr.object as VariableNode).name)) {
      const mapPtr = this.ctx.generateExpression(expr.object, params);
      this.ctx.syncStateToGenerators();
      return this.ctx.mapGen.generateMapSize(mapPtr);
    }
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isSet((expr.object as VariableNode).name)) {
      const setPtr = this.ctx.generateExpression(expr.object, params);
      this.ctx.syncStateToGenerators();
      return this.ctx.setGen.generateSetSize(setPtr);
    }
    return null;
  }

  private handleResponseProperty(expr: MemberAccessNode): string | null {
    if (expr.property !== 'status' && expr.property !== 'ok') return null;
    if (expr.object.type !== 'variable') return null;

    const varName = (expr.object as VariableNode).name;
    const varType = this.ctx.getVariableType(varName);
    if (varType !== '%Response*' && varType !== 'i8*') return null;

    const varPtr = this.ctx.getVariableAlloca(varName);
    let responsePtr: string;

    if (varType === 'i8*') {
      const i8Ptr = this.ctx.nextTemp();
      this.ctx.emit(`${i8Ptr} = load i8*, i8** ${varPtr}`);
      responsePtr = this.ctx.nextTemp();
      this.ctx.emit(`${responsePtr} = bitcast i8* ${i8Ptr} to %Response*`);
    } else {
      responsePtr = this.ctx.nextTemp();
      this.ctx.emit(`${responsePtr} = load %Response*, %Response** ${varPtr}`);
    }

    this.ctx.syncStateToGenerators();
    if (expr.property === 'status') {
      return this.ctx.responseGen.generateStatus(responsePtr);
    } else {
      return this.ctx.responseGen.generateOk(responsePtr);
    }
  }

  private handleParameterPropertyAccess(expr: MemberAccessNode, params: string[]): string {
    if (expr.object.type !== 'variable') {
      throw new Error(this.ctx.formatCodegenError(`Unknown property: ${expr.property} (object type: ${expr.object.type})`));
    }

    const varName = (expr.object as VariableNode).name;

    const symbol = this.ctx.symbolTable.lookup(varName);
    if (symbol && symbol.kind === 'object' && symbol.objectMetadata) {
      return this.accessObjectWithMetadata(varName, expr.property, symbol.objectMetadata);
    }

    if (params.includes(varName)) {
      const paramInterfaceType = this.getParameterTypeFromAST(varName);
      if (paramInterfaceType) {
        const interfaceDefResult = this.getInterfaceFromAST(paramInterfaceType);
        if (interfaceDefResult) {
          const interfaceDef = interfaceDefResult as InterfaceInfo;
          let propIndex = -1;
          for (let pi = 0; pi < interfaceDef.properties.length; pi++) {
            const p = interfaceDef.properties[pi] as InterfaceProperty;
            if (p.name === expr.property) {
              propIndex = pi;
              break;
            }
          }
          if (propIndex !== -1) {
            const propField = interfaceDef.properties[propIndex] as InterfaceProperty;
            const propType = propField.type;
            const paramPtr = this.ctx.getVariableAlloca(varName);
            if (paramPtr) {
              const structTypes: string[] = [];
              for (let i = 0; i < interfaceDef.properties.length; i++) {
                const prop = interfaceDef.properties[i] as InterfaceProperty;
                const t = prop.type;
                if (t === 'string') structTypes.push('i8*');
                else if (t === 'number') structTypes.push('double');
                else if (t === 'boolean') structTypes.push('i32');
                else structTypes.push('i8*');
              }
              const structType = `{ ${structTypes.join(', ')} }`;
              const objPtrI32 = this.ctx.nextTemp();
              this.ctx.emit(`${objPtrI32} = load i32, i32* ${paramPtr}`);
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = inttoptr i32 ${objPtrI32} to ${structType}*`);
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`);
              if (propType === 'string') {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                this.ctx.variableTypes.set(value, 'i8*');
                return value;
              } else if (propType === 'number') {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                this.ctx.variableTypes.set(value, 'double');
                return value;
              } else if (propType === 'boolean') {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load i32, i32* ${fieldPtr}`);
                this.ctx.variableTypes.set(value, 'i32');
                return value;
              }
            }
          }
        }
      }

      const suggestion =
        `\x1b[33mWhy this happens:\x1b[0m\n` +
        `ChadScript needs TypeScript type annotations to compile object parameters.\n\n` +
        `\x1b[33mSolution:\x1b[0m Add a TypeScript interface:\n` +
        `  \x1b[32minterface MyType {\x1b[0m\n` +
        `  \x1b[32m  ${expr.property}: string;  // or number, etc.\x1b[0m\n` +
        `  \x1b[32m}\x1b[0m\n` +
        `  \x1b[32mfunction ${this.ctx.currentFunction}(${varName}: MyType) { ... }\x1b[0m\n\n` +
        `Without TypeScript types, ChadScript can't determine struct layout at compile-time.\n` +
        `Use \x1b[36m.ts\x1b[0m files instead of \x1b[36m.js\x1b[0m to enable type-aware compilation.`;

      throw new Error(this.ctx.formatCodegenError(
        `Cannot access property '${expr.property}' on function parameter '${varName}'.`,
        suggestion
      ));
    }

    const suggestion =
      `\x1b[33mThis variable exists but ChadScript doesn't know its type.\x1b[0m\n\n` +
      `ChadScript tracks these types automatically:\n` +
      `  • Objects: \x1b[32mconst obj = { x: 5, y: 10 }; obj.x\x1b[0m ✅\n` +
      `  • Arrays: \x1b[32mconst arr = [1,2,3]; arr[0]\x1b[0m ✅\n` +
      `  • Classes: \x1b[32mconst p = new Point(1, 2); p.x\x1b[0m ✅\n` +
      `  • Maps/Sets: \x1b[32mconst m = new Map(); m.set(...)\x1b[0m ✅\n\n` +
      `Common issues:\n` +
      `  • Variable assigned from function return? Return type might be unclear.\n` +
      `  • Variable assigned conditionally? Type tracking might lose it.\n` +
      `  • Imported from another file? Cross-file tracking not implemented yet.\n\n` +
      `\x1b[33mDebug tip:\x1b[0m Where is '${varName}' assigned? Does it come from an object literal?`;

    throw new Error(this.ctx.formatCodegenError(
      `Cannot access property '${expr.property}' on variable '${varName}'.`,
      suggestion
    ));
  }

  private accessTypedParameter(varName: string, property: string, typeInfo: TypeInfo): string {
    const properties = Array.from(typeInfo.properties!.entries()) as [string, PropertyTypeInfo][];
    const propInfo = typeInfo.properties!.get(property)!;

    const structTypes: string[] = [];
    for (let i = 0; i < properties.length; i++) {
      const entry = properties[i] as [string, PropertyTypeInfo];
      const info = entry[1];
      structTypes.push(info.type);
    }
    const structType = `{ ${structTypes.join(', ')} }`;
    let propIndex = -1;
    for (let i = 0; i < properties.length; i++) {
      const entry = properties[i] as [string, PropertyTypeInfo];
      const name = entry[0];
      if (name === property) {
        propIndex = i;
        break;
      }
    }

    const paramPtr = this.ctx.getVariableAlloca(varName);
    if (!paramPtr) {
      throw new Error(`Parameter ${varName} not found in variables`);
    }
    const objPtrI32 = this.ctx.nextTemp();
    this.ctx.emit(`${objPtrI32} = load i32, i32* ${paramPtr}`);

    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = inttoptr i32 ${objPtrI32} to i8*`);

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propInfo.type}, ${propInfo.type}* ${fieldPtr}`);

    return value;
  }

  private handleTypeAssertionPropertyAccess(
    expr: MemberAccessNode,
    params: string[]
  ): string | null {
    if (expr.object.type !== 'type_assertion') return null;

    const assertion = expr.object as TypeAssertionNode;
    const assertedType = assertion.assertedType;
    const property = expr.property;

    let fields: InterfaceField[] = [];

    if (assertedType.startsWith('{')) {
      const inlineFields = this.parseInlineObjectTypeForAssertion(assertedType);
      if (!inlineFields) {
        const syntheticExpr: MemberAccessNode = {
          type: 'member_access',
          object: assertion.expression,
          property: property
        };
        return this.generate(syntheticExpr, params);
      }
      fields = inlineFields;
    } else {
      const interfaceDefResult = this.ctx.ast?.interfaces?.find(
        (iface: InterfaceDeclaration) => iface.name === assertedType
      );
      if (!interfaceDefResult) {
        const syntheticExpr: MemberAccessNode = {
          type: 'member_access',
          object: assertion.expression,
          property: property
        };
        return this.generate(syntheticExpr, params);
      }
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      fields = interfaceDef.fields;
    }

    let fieldIndex = -1;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      if (f.name === property) {
        fieldIndex = i;
        break;
      }
    }
    if (fieldIndex === -1) return null;

    const field = fields[fieldIndex] as { name: string; type: string };
    const fieldLlvmType = this.tsTypeToLlvm(field.type);

    const types: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      types.push(this.tsTypeToLlvm(f.type));
    }
    const structType = `{ ${types.join(', ')} }`;

    const objPtr = this.ctx.generateExpression(assertion.expression, params);

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${fieldIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${fieldLlvmType}, ${fieldLlvmType}* ${fieldPtr}`);
    this.ctx.variableTypes.set(value, fieldLlvmType);

    if (field.type && !['string', 'number', 'boolean'].includes(field.type) && !field.type.endsWith('[]')) {
      this.storeInterfaceMetadata(value, field.type);
    }

    return value;
  }

  private parseInlineObjectTypeForAssertion(typeStr: string): InterfaceField[] | null {
    if (!typeStr.startsWith('{') || !typeStr.endsWith('}')) {
      return null;
    }
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) {
      return [];
    }
    const fields: InterfaceField[] = [];
    const parts = inner.split(';');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const name = part.slice(0, colonIdx).trim();
      const fieldType = part.slice(colonIdx + 1).trim();
      fields.push({ name, type: fieldType });
    }
    return fields;
  }

  private accessObjectWithMetadata(varName: string, property: string, metadata: { keys: string[]; types: string[] }): string {
    const propIndex = metadata.keys.indexOf(property);
    if (propIndex === -1) {
      throw new Error(this.ctx.formatCodegenError(
        `Property '${property}' not found on object '${varName}'. Available properties: ${metadata.keys.join(', ')}`
      ));
    }

    const propType = metadata.types[propIndex];
    const structType = `{ ${metadata.types.join(', ')} }`;

    const varPtr = this.ctx.getVariableAlloca(varName);
    if (!varPtr) {
      throw new Error(`Variable ${varName} not found in symbol table`);
    }

    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = load i8*, i8** ${varPtr}`);

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.variableTypes.set(value, propType);

    return value;
  }

  private accessObjectProperty(objPtr: string, property: string, keys: string[], types: string[], tsTypes?: string[]): string {
    const propIndex = keys.indexOf(property);
    if (propIndex === -1) {
      throw new Error(this.ctx.formatCodegenError(
        `Property '${property}' not found. Available properties: ${keys.join(', ')}`
      ));
    }

    const propType = types[propIndex];
    const structType = `{ ${types.join(', ')} }`;

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.variableTypes.set(value, propType);

    return value;
  }
}
