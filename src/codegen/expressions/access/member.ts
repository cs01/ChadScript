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
} from '../../../ast/types.js';
import type { SymbolTable, Symbol as SymbolEntry } from '../../infrastructure/symbol-table.js';
import type { TypeChecker } from '../../../typescript/type-checker.js';
import type { InterfaceStructGenerator } from '../../types/interface-struct-generator.js';
import { stripOptional, stripNullable, tsTypeToLlvm as tsTypeToLlvmUtil } from '../../infrastructure/type-system.js';

interface ExprBase { type: string; }

interface ClassGeneratorLike {
  getFieldInfo(className: string, fieldName: string): FieldInfo | null;
  getClassFields(className: string): FieldInfo[];
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
  emit(instruction: string): void;
  symbolTable: SymbolTable;
  symbolTableLookup(name: string): SymbolEntry | undefined;
  symbolTableIsClass(name: string): boolean;
  symbolTableIsJSON(name: string): boolean;
  symbolTableIsObject(name: string): boolean;
  symbolTableIsMap(name: string): boolean;
  symbolTableIsSet(name: string): boolean;
  symbolTableIsNumberArray(name: string): boolean;
  symbolTableIsStringArray(name: string): boolean;
  symbolTableIsObjectArray(name: string): boolean;
  symbolTableIsString(name: string): boolean;
  symbolTableIsRegex(name: string): boolean;
  symbolTableGetType(name: string): string | undefined;
  symbolTableGetClassName(name: string): string | undefined;
  symbolTableGetClassInfo(name: string): { ptr: string; className: string } | undefined;
  symbolTableGetObjectInfo(name: string): { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] } | undefined;
  symbolTableGetMapMetadata(name: string): { keyType: string; valueType: string } | undefined;
  symbolTableGetSetMetadata(name: string): { valueType: string } | undefined;
  symbolTableGetInterfaceType(name: string): string | undefined;
  symbolTableGetAlloca(name: string): string | undefined;
  symbolTableGetObjectArrayMetadata(name: string): { elementInterfaceName: string; elementKeys: string[]; elementTypes: string[]; elementTsTypes?: string[] } | undefined;
  variableTypes: Map<string, string>;
  ast?: AST;
  getAst(): AST | undefined;
  typeChecker?: TypeChecker | null;
  thisPointer?: string | null;
  currentClassName?: string | null;
  currentFunction?: string | null;
  jsonObjectMetadata?: Map<string, JsonObjectMeta>;
  interfaceStructGen?: InterfaceStructGenerator;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  getVariableAlloca(name: string): string | undefined;
  syncStateToGenerators(): void;
  formatCodegenError(message: string, suggestion?: string): string;
  getObjectMetadata(obj: ObjectNode): ObjectMetadata;
  classGen: ClassGeneratorLike;
  classGenGetFieldInfo(className: string, fieldName: string): FieldInfo | null;
  classGenGetClassFields(className: string): FieldInfo[];
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

  private findClassImplementingInterface(interfaceName: string): string | null {
    const ast = this.ctx.getAst();
    if (!ast?.classes) return null;
    const classes = ast.classes;
    let implementingClass: string | null = null;
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i] as { name: string; implements?: string[] };
      if (cls.implements) {
        for (let j = 0; j < cls.implements.length; j++) {
          if (cls.implements[j] === interfaceName) {
            if (cls.name.indexOf('Mock') !== -1 || cls.name.indexOf('Test') !== -1) {
              continue;
            }
            if (implementingClass !== null) {
              return null;
            }
            implementingClass = cls.name;
          }
        }
      }
    }
    if (implementingClass) {
      return implementingClass;
    }
    if (interfaceName.endsWith('Context') || interfaceName.endsWith('Like')) {
      for (let i = 0; i < classes.length; i++) {
        const cls = classes[i] as { name: string; implements?: string[] };
        if (cls.implements) {
          for (let j = 0; j < cls.implements.length; j++) {
            if (cls.implements[j] === 'IGeneratorContext') {
              if (cls.name.indexOf('Mock') === -1 && cls.name.indexOf('Test') === -1) {
                return cls.name;
              }
            }
          }
        }
      }
    }
    return null;
  }

  private getInterfaceFromAST(name: string): InterfaceInfo | null {
    const baseName = this.extractBaseTypeName(name);
    const ast = this.ctx.getAst();
    if (!ast?.interfaces) return null;

    const properties: InterfaceProperty[] = [];
    const seenProps = new Set<string>();

    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === baseName) {
        if (!iface.fields) continue;
        for (let j = 0; j < iface.fields.length; j++) {
          const field = iface.fields[j] as { name: string; type: string };
          let fieldName = field.name;
          if (fieldName.endsWith('?')) {
            fieldName = fieldName.slice(0, -1);
          }
          if (!seenProps.has(fieldName)) {
            seenProps.add(fieldName);
            properties.push({ name: fieldName, type: field.type });
          }
        }
      }
    }

    if (properties.length > 0) {
      return { properties };
    }

    const typeAliasResult = this.getTypeAliasCommonProperties(baseName);
    if (typeAliasResult) return typeAliasResult;
    return null;
  }

  private getInterfaceDecl(name: string): InterfaceDeclaration | null {
    const ast = this.ctx.getAst();
    if (!ast?.interfaces) return null;
    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) {
        return iface;
      }
    }
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
    const ast = this.ctx.getAst();
    if (!ast?.typeAliases) return false;
    for (let i = 0; i < ast.typeAliases.length; i++) {
      const ta = ast.typeAliases[i] as { name: string };
      if (ta.name === name) {
        return true;
      }
    }
    return false;
  }

  private getTypeAliasCommonProperties(name: string): { properties: InterfaceProperty[] } | null {
    const ast = this.ctx.getAst();
    if (!ast?.typeAliases || !ast?.interfaces) return null;
    let typeAlias: { name: string; unionMembers: string[] } | null = null;
    for (let i = 0; i < ast.typeAliases.length; i++) {
      const ta = ast.typeAliases[i] as { name: string; unionMembers: string[] };
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
      for (let j = 0; j < ast.interfaces.length; j++) {
        const iface = ast.interfaces[j] as InterfaceDeclaration;
        if (iface.name === memberName) {
          const properties: InterfaceProperty[] = [];
          if (!iface.fields) {
            found = { properties };
            break;
          }
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
    if (!firstMember.properties) return null;
    const firstProps = firstMember.properties;
    if (firstProps.length === 0) return null;
    for (let i = 0; i < firstProps.length; i++) {
      const prop = firstProps[i] as InterfaceProperty;
      let existsInAll = true;
      let unifiedType = prop.type;
      for (let j = 1; j < memberInterfaces.length; j++) {
        const member = memberInterfaces[j] as { properties: InterfaceProperty[] };
        if (!member.properties) {
          existsInAll = false;
          break;
        }
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

    const typedJsonResult = this.handleTypedJsonStructAccess(expr);
    if (typedJsonResult !== null) return typedJsonResult;

    if (this.isProcessArgv(expr)) {
      return this.handleProcessArgv();
    }

    const classResult = this.handleClassPropertyAccess(expr, params);
    if (classResult !== null) return classResult;

    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase ? exprObjBase.type : null;
    if (exprObjType === null || exprObjType === undefined) {
      return '0.0';
    }

    if (exprObjType === 'variable' && this.ctx.symbolTableIsJSON((expr.object as VariableNode).name)) {
      return this.handleJsonPropertyAccess(expr, params);
    }

    // Handle nested JSON object access
    if (exprObjType === 'member_access') {
      const chainedResult = this.handleChainedInterfaceAccess(expr, params);
      if (chainedResult !== null) return chainedResult;

      const classFieldChainResult = this.handleClassFieldChainedAccess(expr, params);
      if (classFieldChainResult !== null) return classFieldChainResult;

      const nestedResult = this.handleNestedJsonAccess(expr, params);
      if (nestedResult !== null) return nestedResult;
    }

    // Handle indexed access to object array elements (e.g., arr[i].property)
    if (exprObjType === 'index_access') {
      const indexResult = this.handleIndexAccessPropertyAccess(expr, params);
      if (indexResult !== null) return indexResult;
    }

    // Handle type assertion property access (e.g., (expr as Type).property)
    if (exprObjType === 'type_assertion') {
      const assertResult = this.handleTypeAssertionPropertyAccess(expr, params);
      if (assertResult !== null) return assertResult;
    }

    // Handle method call result property access (e.g., map.get(key)?.property)
    if (exprObjType === 'method_call') {
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
    const exprObjBase = expr.object as ExprBase;
    return exprObjBase.type === 'variable' &&
           (expr.object as VariableNode).name === 'process' &&
           expr.property === 'argv';
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
    if (exprObjType !== 'variable') return null;

    const exprObjVar = expr.object as VariableNode;
    const enumName = exprObjVar.name;
    const memberName = expr.property;
    const ast = this.ctx.getAst();
    if (!ast) {
      return null;
    }
    const enums = ast.enums;
    if (!enums) return null;

    let enumDeclResult: EnumDeclaration | null = null;
    for (let ei = 0; ei < enums.length; ei++) {
      const e = enums[ei] as EnumDeclaration;
      if (e && e.name === enumName) {
        enumDeclResult = e;
        break;
      }
    }
    const enumDecl = enumDeclResult as EnumDeclaration;
    if (!enumDeclResult) {
      return null;
    }

    let memberResult: EnumMember | null = null;
    for (let mi = 0; mi < enumDecl.members.length; mi++) {
      const m = enumDecl.members[mi] as EnumMember;
      if (m.name === memberName) {
        memberResult = m;
        break;
      }
    }
    const member = memberResult as EnumMember;
    if (!memberResult) {
      throw new Error(`Enum member '${memberName}' not found in enum '${enumName}'`);
    }

    const value = member.value;
    const result = this.ctx.nextTemp();
    const valueStr = String(value);
    const formattedValue = valueStr.indexOf('.') === -1 ? valueStr + '.0' : valueStr;
    this.ctx.emit(`${result} = fadd double ${formattedValue}, 0.0`);
    this.ctx.setVariableType(result, 'double');
    return result;
  }

  private handleTypedJsonStructAccess(expr: MemberAccessNode): string | null {
    if (!expr.object) {
      return null;
    }
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase ? exprObjBase.type : null;
    if (exprObjType !== 'variable') return null;

    const varName = (expr.object as VariableNode).name;
    const varType = this.ctx.getVariableType(varName);
    if (!varType) {
      return null;
    }
    const startsWithPercent = varType.charAt(0) === '%';
    const endsWithStar = varType.charAt(varType.length - 1) === '*';
    if (!startsWithPercent || !endsWithStar) {
      return null;
    }
    if (varType === '%Response*' || varType.indexOf('Array') !== -1 || varType.indexOf('Map') !== -1 || varType.indexOf('Set') !== -1) {
      return null;
    }

    const structTypeName = varType.substring(1, varType.length - 1);

    const interfaceDefResult = this.getInterfaceFromAST(structTypeName);
    if (!interfaceDefResult) return null;
    const interfaceDef = interfaceDefResult as InterfaceInfo;
    if (!interfaceDef.properties) return null;

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
    const propName = propField.name;
    const varPtr = this.ctx.getVariableAlloca((expr.object as VariableNode).name);
    const structPtr = this.ctx.nextTemp();
    this.ctx.emit(`${structPtr} = load %${structTypeName}*, %${structTypeName}** ${varPtr}`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${structTypeName}, %${structTypeName}* ${structPtr}, i32 0, i32 ${propIndex}`);

    if (propName === 'nodePtr' || propName === 'treePtr') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, 'i8*');
      return value;
    } else if (propType === 'string') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, 'i8*');
      return value;
    } else if (propType === 'number') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, 'double');
      return value;
    } else if (propType === 'boolean') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i1, i1* ${fieldPtr}`);
      const doubleValue = this.ctx.nextTemp();
      this.ctx.emit(`${doubleValue} = uitofp i1 ${value} to double`);
      this.ctx.setVariableType(doubleValue, 'double');
      return doubleValue;
    } else if (propType === 'string[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%StringArray*');
      return value;
    } else {
      let nestedTypeName = propType;
      if (nestedTypeName.endsWith('?')) {
        nestedTypeName = nestedTypeName.slice(0, -1);
      }
      if (nestedTypeName.indexOf(' | ') !== -1) {
        nestedTypeName = nestedTypeName.split(' | ')[0].trim();
      }
      const isTypeAlias = this.isTypeAlias(nestedTypeName);
      const nestedInterfaceResult = this.getInterfaceFromAST(nestedTypeName);
      if (nestedInterfaceResult) {
        const nestedInterface = nestedInterfaceResult as InterfaceInfo;
        const value = this.ctx.nextTemp();
        if (isTypeAlias) {
          this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
          this.ctx.setVariableType(value, 'i8*');
          const keys: string[] = [];
          const types: string[] = [];
          const tsTypes: string[] = [];
          const nestedProps = nestedInterface.properties as InterfaceProperty[];
          for (let pi = 0; pi < nestedProps.length; pi++) {
            const p = nestedProps[pi] as { name: string; type: string };
            keys.push(stripOptional(p.name));
            types.push(this.tsTypeToLlvm(p.type));
            tsTypes.push(p.type);
          }
          this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
          this.ctx.jsonObjectMetadata.set(value, { keys, types, tsTypes });
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
    const argvSkipFirst = this.ctx.nextTemp();
    this.ctx.emit(`${argvSkipFirst} = getelementptr i8*, i8** ${argvPtr}, i32 1`);
    this.ctx.emit(`store i8** ${argvSkipFirst}, i8*** ${dataField}`);

    const lenField = this.ctx.nextTemp();
    this.ctx.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 1`);
    const argc = this.ctx.nextTemp();
    this.ctx.emit(`${argc} = load i32, i32* @__argc`);
    const argcMinusOne = this.ctx.nextTemp();
    this.ctx.emit(`${argcMinusOne} = sub i32 ${argc}, 1`);
    this.ctx.emit(`store i32 ${argcMinusOne}, i32* ${lenField}`);

    const capField = this.ctx.nextTemp();
    this.ctx.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 2`);
    this.ctx.emit(`store i32 ${argcMinusOne}, i32* ${capField}`);

    this.ctx.setVariableType(argvStruct, '%StringArray*');
    return argvStruct;
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
    if (exprObjType === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const isClass = this.ctx.symbolTableIsClass(varName);
      if (isClass) {
        const classMeta = this.ctx.symbolTableGetClassInfo((expr.object as VariableNode).name);
        if (classMeta) {
          className = classMeta.className;
          instancePtr = this.ctx.generateExpression(expr.object, params);
        }
      }
    } else if (exprObjType === 'new') {
      const newExpr = expr.object as NewNode;
      className = newExpr.className;
      instancePtr = this.ctx.generateExpression(expr.object, params);
    } else if (exprObjType === 'this') {
      const thisPtr = this.ctx.thisPointer;
      if (!thisPtr) {
        throw new Error('this.field accessed outside of class method or constructor');
      }
      instancePtr = thisPtr;
      className = this.ctx.currentClassName || null;
      if (!className) {
        const fieldName = expr.property;
        let classWithFieldResult: ClassNode | null = null;
        const astClasses = this.ctx.getAst()?.classes;
        const classes = astClasses || [];
        for (let ci = 0; ci < classes.length; ci++) {
          const c = classes[ci] as ClassNode;
          let hasField = false;
          if (!c.fields) continue;
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

    if (!className || !instancePtr) {
      return null;
    }

    const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, expr.property);
    const fields = this.ctx.classGenGetClassFields(className);

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
      this.ctx.setVariableType(value, 'i8*');
      if (fieldInfo.tsType) {
        this.storeInterfaceMetadata(value, fieldInfo.tsType);
      }
      return value;
    } else if (fieldInfo.type === 'string[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%StringArray*');
      return value;
    } else if (fieldInfo.type.endsWith('[]')) {
      const tsType = fieldInfo.tsType || fieldInfo.type;
      const isObjectArray = tsType.endsWith('[]') && tsType !== 'number[]' && tsType !== 'string[]' && tsType !== 'boolean[]';
      const value = this.ctx.nextTemp();
      if (isObjectArray) {
        this.ctx.emit(`${value} = load %ObjectArray*, %ObjectArray** ${fieldPtr}`);
        this.ctx.setVariableType(value, '%ObjectArray*');
      } else {
        this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
        this.ctx.setVariableType(value, '%Array*');
      }
      return value;
    } else if (fieldInfo.type === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = load i1, i1* ${fieldPtr}`);
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = uitofp i1 ${boolValue} to double`);
      this.ctx.setVariableType(value, 'double');
      return value;
    } else if (fieldInfo.tsType?.startsWith('Map<string,')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringMap*, %StringMap** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%StringMap*');
      return value;
    } else if (fieldInfo.tsType?.startsWith('Map<')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Map*, %Map** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%Map*');
      return value;
    } else if (fieldInfo.tsType === 'Set<string>') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringSet*, %StringSet** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%StringSet*');
      return value;
    } else if (fieldInfo.tsType?.startsWith('Set<')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Set*, %Set** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%Set*');
      return value;
    } else if ((fieldInfo.type === 'double' || fieldInfo.type === 'number') &&
               (!fieldInfo.tsType || fieldInfo.tsType === 'number' || fieldInfo.tsType === 'boolean')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, 'double');
      return value;
    } else if (fieldInfo.tsType?.endsWith('[]')) {
      const tsType = fieldInfo.tsType;
      const isObjectArray = tsType !== 'number[]' && tsType !== 'string[]' && tsType !== 'boolean[]';
      const value = this.ctx.nextTemp();
      if (isObjectArray) {
        this.ctx.emit(`${value} = load %ObjectArray*, %ObjectArray** ${fieldPtr}`);
        this.ctx.setVariableType(value, '%ObjectArray*');
      } else {
        this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
        this.ctx.setVariableType(value, '%Array*');
      }
      return value;
    } else {
      const value = this.ctx.nextTemp();
      const classNode = this.ctx.classGenGetClassFields(fieldInfo.tsType || '');
      if (classNode.length > 0) {
        const structType = `%${fieldInfo.tsType}_struct*`;
        this.ctx.emit(`${value} = load ${structType}, ${structType}* ${fieldPtr}`);
        this.ctx.setVariableType(value, structType);
      } else if (fieldInfo.tsType && this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(fieldInfo.tsType)) {
        const structType = `%${fieldInfo.tsType}*`;
        this.ctx.emit(`${value} = load ${structType}, ${structType}* ${fieldPtr}`);
        this.ctx.setVariableType(value, structType);
      } else {
        this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
        this.ctx.setVariableType(value, 'i8*');
        if (fieldInfo.tsType) {
          this.storeInterfaceMetadata(value, fieldInfo.tsType);
        }
      }
      return value;
    }
  }

  private storeInterfaceMetadata(register: string, tsType: string): void {
    if (this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(tsType)) {
      const interfaceInfo = this.ctx.interfaceStructGen.getInterfaceStruct(tsType);
      if (interfaceInfo) {
        const keys: string[] = [];
        const tsTypes: string[] = [];
        const types: string[] = [];
        const fields = interfaceInfo.fields as { name: string; tsType: string; llvmType: string }[];
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i] as { name: string; tsType: string; llvmType: string };
          keys.push(f.name);
          tsTypes.push(f.tsType);
          types.push(f.llvmType);
        }
        this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
        this.ctx.jsonObjectMetadata.set(register, { keys, types, tsTypes, interfaceType: tsType });
        return;
      }
    }
    const interfaceDefResult = this.getInterfaceDecl(tsType);
    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      if (interfaceDef.fields) {
        for (let i = 0; i < interfaceDef.fields.length; i++) {
          const f = interfaceDef.fields[i] as { name: string; type: string };
          keys.push(stripOptional(f.name));
          tsTypes.push(f.type);
          types.push(this.tsTypeToLlvm(f.type));
        }
      }
      this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
      this.ctx.jsonObjectMetadata.set(register, { keys, types, tsTypes });
    } else if (tsType === 'Expression' || tsType === 'Statement') {
      this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
      this.ctx.jsonObjectMetadata.set(register, { keys: ['type'], types: ['i8*'], tsTypes: ['string'] });
    }
  }

  private handleJsonPropertyAccess(expr: MemberAccessNode, _params: string[]): string {
    const varName = (expr.object as VariableNode).name;

    if (expr.property === 'length') {
      const jsonObjPtrPtr = this.ctx.getVariableAlloca(varName)!;
      const jsonObjPtr = this.ctx.nextTemp();
      this.ctx.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);
      const arraySize = this.ctx.nextTemp();
      this.ctx.emit(`${arraySize} = call i32 @cJSON_GetArraySize(i8* ${jsonObjPtr})`);
      const sizeDouble = this.ctx.nextTemp();
      this.ctx.emit(`${sizeDouble} = sitofp i32 ${arraySize} to double`);
      this.ctx.setVariableType(sizeDouble, 'double');
      return sizeDouble;
    }

    const jsonMetaRaw = this.ctx.symbolTableGetObjectInfo(varName);
    let tsType: string | undefined;
    if (jsonMetaRaw) {
      const jsonMeta = jsonMetaRaw as { ptr: string; keys: string[]; types: string[]; tsTypes: string[] | undefined };
      if (jsonMeta.tsTypes) {
        const tsTypesArr = jsonMeta.tsTypes as string[];
        const propIdx = jsonMeta.keys.indexOf(expr.property);
        if (propIdx !== -1) {
          tsType = tsTypesArr[propIdx];
        }
      }
    }

    const jsonObjPtrPtr = this.ctx.getVariableAlloca(varName)!;
    const jsonObjPtr = this.ctx.nextTemp();
    this.ctx.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);

    this.ctx.syncStateToGenerators();
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);

    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

    if (tsType && ['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].indexOf(tsType) === -1) {
      return this.handleNestedInterfaceField(fieldItem, tsType);
    }

    if (tsType === 'string') {
      const strValue = this.ctx.nextTemp();
      this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
      this.ctx.setVariableType(strValue, 'i8*');
      return strValue;
    } else if (tsType === 'number') {
      const numValue = this.ctx.nextTemp();
      this.ctx.emit(`${numValue} = call double @cJSON_GetNumberValue(i8* ${fieldItem})`);
      this.ctx.setVariableType(numValue, 'double');
      return numValue;
    } else if (tsType === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = call i32 @cJSON_IsTrue(i8* ${fieldItem})`);
      const boolAsDouble = this.ctx.nextTemp();
      this.ctx.emit(`${boolAsDouble} = sitofp i32 ${boolValue} to double`);
      this.ctx.setVariableType(boolAsDouble, 'double');
      return boolAsDouble;
    } else if (tsType === 'string[]' || tsType === 'number[]' || tsType === 'boolean[]') {
      this.ctx.setVariableType(fieldItem, 'i8*');
      return fieldItem;
    }

    return this.extractJsonFieldValue(fieldItem);
  }

  private handleNestedInterfaceField(fieldItem: string, tsType: string): string {
    const baseType = stripNullable(tsType);
    const nestedInterfaceDefResult = this.getInterfaceDecl(baseType);
    const nestedInterfaceDef = nestedInterfaceDefResult as InterfaceDeclaration;
    if (nestedInterfaceDefResult) {
      const keys: string[] = [];
      const tsTypes: string[] = [];
      const types: string[] = [];
      if (nestedInterfaceDef.fields) {
        for (let i = 0; i < nestedInterfaceDef.fields.length; i++) {
          const f = nestedInterfaceDef.fields[i] as { name: string; type: string };
          keys.push(stripOptional(f.name));
          tsTypes.push(f.type);
          types.push(this.tsTypeToLlvm(f.type));
        }
      }
      this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
      this.ctx.jsonObjectMetadata.set(fieldItem, { keys, types, tsTypes });
    }
    this.ctx.setVariableType(fieldItem, 'i8*');
    return fieldItem;
  }

  private tsTypeToLlvm(t: string): string {
    return tsTypeToLlvmUtil(t);
  }

  private interfaceTsTypeToLlvm(t: string): string {
    if (t === 'string') return 'i8*';
    if (t === 'number') return 'double';
    if (t === 'boolean') return 'double';
    if (t === 'string[]') return '%StringArray*';
    if (t === 'number[]' || t === 'boolean[]') return '%Array*';
    if (t.endsWith('[]')) return '%Array*';
    const interfaceInfo = this.getInterfaceFromAST(t);
    if (interfaceInfo) return `%${t}*`;
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
    const numValueDouble = this.ctx.nextTemp();
    this.ctx.emit(`${numValueDouble} = call double @cJSON_GetNumberValue(i8* ${fieldItem})`);
    const numAsStr = this.ctx.nextTemp();
    this.ctx.emit(`${numAsStr} = call i8* @__double_to_string(double ${numValueDouble})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${noFieldLabel}:`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${fieldEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i8* [ ${numAsStr}, %${numberLabel} ], [ ${strValue}, %${stringLabel} ], [ null, %${noFieldLabel} ]`);

    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private handleNestedJsonAccess(expr: MemberAccessNode, params: string[]): string | null {
    const innerResult = this.ctx.generateExpression(expr.object, params);

    const innerType = this.ctx.getVariableType(innerResult);
    if (innerType && innerType.startsWith('%') && innerType.endsWith('*') && innerType !== '%Response*' && innerType.indexOf('Array') === -1 && innerType.indexOf('Map') === -1 && innerType.indexOf('Set') === -1) {
      return null;
    }

    if (!this.ctx.jsonObjectMetadata) return null;
    const nestedMetaRaw = this.ctx.jsonObjectMetadata.get(innerResult);
    if (!nestedMetaRaw) return null;
    const nestedMeta = nestedMetaRaw as { keys: string[]; types: string[]; tsTypes: string[] | undefined };

    this.ctx.syncStateToGenerators();
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);
    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${innerResult}, i8* ${fieldNameStr})`);

    const propIdx = nestedMeta.keys.indexOf(expr.property);
    let tsType: string | undefined;
    if (propIdx !== -1 && nestedMeta.tsTypes) {
      const tsTypesArr = nestedMeta.tsTypes as string[];
      tsType = tsTypesArr[propIdx];
    }

    if (tsType && ['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].indexOf(tsType) === -1) {
      return this.handleNestedInterfaceField(fieldItem, tsType);
    }

    if (tsType === 'string') {
      const strValue = this.ctx.nextTemp();
      this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
      this.ctx.setVariableType(strValue, 'i8*');
      return strValue;
    } else if (tsType === 'number') {
      const numValue = this.ctx.nextTemp();
      this.ctx.emit(`${numValue} = call double @cJSON_GetNumberValue(i8* ${fieldItem})`);
      this.ctx.setVariableType(numValue, 'double');
      return numValue;
    } else if (tsType === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = call i32 @cJSON_IsTrue(i8* ${fieldItem})`);
      const boolAsDouble = this.ctx.nextTemp();
      this.ctx.emit(`${boolAsDouble} = sitofp i32 ${boolValue} to double`);
      this.ctx.setVariableType(boolAsDouble, 'double');
      return boolAsDouble;
    } else if (tsType === 'string[]' || tsType === 'number[]' || tsType === 'boolean[]') {
      this.ctx.setVariableType(fieldItem, 'i8*');
      return fieldItem;
    }

    return this.extractNestedJsonFieldValue(fieldItem);
  }

  private handleChainedInterfaceAccess(expr: MemberAccessNode, params: string[]): string | null {
    const innerPtr = this.ctx.generateExpression(expr.object, params);
    const innerType = this.ctx.getVariableType(innerPtr);

    if (innerType === 'i8*') {
      if (!this.ctx.jsonObjectMetadata) return null;
      const metadataRaw = this.ctx.jsonObjectMetadata.get(innerPtr);
      if (metadataRaw) {
        const metadata = metadataRaw as { keys: string[]; types: string[]; tsTypes: string[] | undefined; interfaceType?: string };
        if (metadata.interfaceType && this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(metadata.interfaceType)) {
          return this.accessObjectPropertyWithNamedInterface(innerPtr, expr.property, metadata.interfaceType);
        }
        if (metadata.keys && metadata.types) {
          const propIndex = metadata.keys.indexOf(expr.property);
          if (propIndex !== -1) {
            return this.accessObjectProperty(innerPtr, expr.property, metadata.keys, metadata.types, metadata.tsTypes);
          }
        }
      }
      if (expr.property === 'type') {
        const structType = '{ i8* }';
        const typedPtr = this.ctx.nextTemp();
        this.ctx.emit(`${typedPtr} = bitcast i8* ${innerPtr} to ${structType}*`);
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 0`);
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
        this.ctx.setVariableType(value, 'i8*');
        return value;
      }
      return null;
    }

    if (!innerType || !innerType.startsWith('%') || !innerType.endsWith('*')) {
      return null;
    }

    let innerInterfaceName = innerType.substring(1, innerType.length - 1);

    const innerInterfaceDefResult = this.getInterfaceFromAST(innerInterfaceName);

    let propIndex = -1;
    let propType = '';
    let fieldPtr = '';

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

      const implementingClass = this.findClassImplementingInterface(innerInterfaceName);
      if (implementingClass) {
        const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
        if (classFieldInfo) {
          const classFieldInfoTyped = classFieldInfo as { index: number; type: string; tsType?: string };
          const castPtr = this.ctx.nextTemp();
          this.ctx.emit(`${castPtr} = bitcast %${innerInterfaceName}* ${innerPtr} to %${implementingClass}_struct*`);
          fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`);
          if (classFieldInfoTyped.tsType) {
            propType = classFieldInfoTyped.tsType;
          }
        } else {
          fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`);
        }
      } else {
        fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`);
      }
    } else if (innerInterfaceName.endsWith('_struct')) {
      const className = innerInterfaceName.slice(0, -7);
      const fieldInfo = this.ctx.classGenGetFieldInfo(className, expr.property);
      if (!fieldInfo) {
        return null;
      }

      propIndex = fieldInfo.index;
      if (fieldInfo.tsType) {
        propType = fieldInfo.tsType;
      } else if (fieldInfo.type === 'double') {
        propType = 'number';
      } else if (fieldInfo.type === 'boolean') {
        propType = 'boolean';
      } else {
        propType = fieldInfo.type;
      }

      fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${innerInterfaceName}, %${innerInterfaceName}* ${innerPtr}, i32 0, i32 ${propIndex}`);
    } else {
      return null;
    }

    if (expr.property === 'nodePtr' || expr.property === 'treePtr') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, 'i8*');
      return value;
    } else if (propType === 'string') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, 'i8*');
      return value;
    } else if (propType === 'number') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.setVariableType(value, 'double');
      return value;
    } else if (propType === 'boolean') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i1, i1* ${fieldPtr}`);
      const doubleValue = this.ctx.nextTemp();
      this.ctx.emit(`${doubleValue} = uitofp i1 ${value} to double`);
      this.ctx.setVariableType(doubleValue, 'double');
      return doubleValue;
    } else if (propType === 'string[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%StringArray*');
      return value;
    } else if (propType === 'number[]' || propType === 'boolean[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%Array*');
      return value;
    } else if (propType.endsWith('[]')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %ObjectArray*, %ObjectArray** ${fieldPtr}`);
      this.ctx.setVariableType(value, '%ObjectArray*');
      return value;
    } else {
      let nestedTypeName = propType;
      if (nestedTypeName.endsWith('?')) {
        nestedTypeName = nestedTypeName.slice(0, -1);
      }
      if (nestedTypeName.indexOf(' | null') !== -1) {
        nestedTypeName = nestedTypeName.replace(' | null', '');
      }
      if (nestedTypeName.indexOf(' | undefined') !== -1) {
        nestedTypeName = nestedTypeName.replace(' | undefined', '');
      }
      if (nestedTypeName === 'string') {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
        this.ctx.setVariableType(value, 'i8*');
        return value;
      }
      if (nestedTypeName === 'number') {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
        this.ctx.setVariableType(value, 'double');
        return value;
      }
      const nestedInterfaceDefResult = this.getInterfaceFromAST(nestedTypeName);
      if (nestedInterfaceDefResult) {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load %${nestedTypeName}*, %${nestedTypeName}** ${fieldPtr}`);
        this.ctx.setVariableType(value, `%${nestedTypeName}*`);
        return value;
      }
      const classFields = this.ctx.classGenGetClassFields(nestedTypeName);
      if (classFields && classFields.length > 0) {
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load %${nestedTypeName}_struct*, %${nestedTypeName}_struct** ${fieldPtr}`);
        this.ctx.setVariableType(value, `%${nestedTypeName}_struct*`);
        return value;
      }
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.setVariableType(value, 'i8*');
      return value;
    }
  }

  private handleClassFieldChainedAccess(expr: MemberAccessNode, params: string[]): string | null {
    const innerExpr = expr.object as MemberAccessNode;
    const innerObjBase = innerExpr.object as ExprBase;

    if (innerObjBase.type !== 'this') return null;

    const className = this.ctx.currentClassName;
    if (!className) return null;

    const fieldName = innerExpr.property;
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, fieldName);
    if (!fieldInfoResult) return null;
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfo.tsType) return null;

    const interfaceDefResult = this.getInterfaceDecl(fieldInfo.tsType);
    if (!interfaceDefResult) {
      const interfaceInfoResult = this.getInterfaceFromAST(fieldInfo.tsType);
      if (!interfaceInfoResult) {
        const nestedClassFields = this.ctx.classGenGetClassFields(fieldInfo.tsType);
        if (nestedClassFields !== undefined) {
          const innerPtrI8 = this.ctx.generateExpression(expr.object, params);
          const nestedFieldInfo = this.ctx.classGenGetFieldInfo(fieldInfo.tsType, expr.property);
          if (nestedFieldInfo) {
            const nestedFieldInfoTyped = nestedFieldInfo as { index: number; type: string; tsType?: string };
            const innerPtr = this.ctx.nextTemp();
            this.ctx.emit(`${innerPtr} = bitcast i8* ${innerPtrI8} to %${fieldInfo.tsType}_struct*`);
            const fieldPtr = this.ctx.nextTemp();
            this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${fieldInfo.tsType}_struct, %${fieldInfo.tsType}_struct* ${innerPtr}, i32 0, i32 ${nestedFieldInfoTyped.index}`);
            return this.loadFieldValue(fieldPtr, nestedFieldInfo);
          }
        }
        return null;
      }

      const implementingClass = this.findClassImplementingInterface(fieldInfo.tsType);
      if (implementingClass) {
        const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
        if (classFieldInfo) {
          const classFieldInfoTyped = classFieldInfo as { index: number; type: string; tsType?: string };
          const innerPtr = this.ctx.generateExpression(expr.object, params);
          const castPtr = this.ctx.nextTemp();
          this.ctx.emit(`${castPtr} = bitcast %${fieldInfo.tsType}* ${innerPtr} to %${implementingClass}_struct*`);
          const fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`);
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

      let propIndex = -1;
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
      const llvmType = this.tsTypeToLlvm(propType);

      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${fieldInfo.tsType}, %${fieldInfo.tsType}* ${innerPtr}, i32 0, i32 ${propIndex}`);

      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load ${llvmType}, ${llvmType}* ${fieldPtr}`);
      this.ctx.setVariableType(value, llvmType);
      return value;
    }

    const implementingClass2 = this.findClassImplementingInterface(fieldInfo.tsType);
    if (implementingClass2) {
      const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass2, expr.property);
      if (classFieldInfo) {
        const classFieldInfoTyped = classFieldInfo as { index: number; type: string; tsType?: string };
        const innerPtr = this.ctx.generateExpression(expr.object, params);
        const castPtr = this.ctx.nextTemp();
        this.ctx.emit(`${castPtr} = bitcast %${fieldInfo.tsType}* ${innerPtr} to %${implementingClass2}_struct*`);
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${implementingClass2}_struct, %${implementingClass2}_struct* ${castPtr}, i32 0, i32 ${classFieldInfoTyped.index}`);
        return this.loadFieldValue(fieldPtr, classFieldInfo);
      }
    }

    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    if (!interfaceDef.fields) return null;
    let propIndex = -1;
    let propTsType: string | undefined;
    for (let i = 0; i < interfaceDef.fields.length; i++) {
      const f = interfaceDef.fields[i] as { name: string; type: string };
      const fName = stripOptional(f.name);
      if (fName === expr.property) {
        propIndex = i;
        propTsType = f.type;
        break;
      }
    }
    if (propIndex === -1) return null;

    const innerPtr = this.ctx.generateExpression(expr.object, params);
    const llvmType = this.tsTypeToLlvm(propTsType || 'i8*');

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${fieldInfo.tsType}, %${fieldInfo.tsType}* ${innerPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${llvmType}, ${llvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, llvmType);

    if (propTsType && propTsType !== 'string' && propTsType !== 'number' && propTsType !== 'boolean') {
      this.storeInterfaceMetadata(value, propTsType);
    }
    return value;
  }

  private handleIndexAccessPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    const indexAccess = expr.object as IndexAccessNode;
    const elementInfoRaw = this.getObjectArrayElementInfo(indexAccess.object);
    if (!elementInfoRaw) return null;
    const elementInfo = elementInfoRaw as { keys: string[]; types: string[]; tsTypes: string[] };

    const arrayPtr = this.ctx.generateExpression(indexAccess.object, params);
    const indexDouble = this.ctx.generateExpression(indexAccess.index, params);

    const indexType = this.ctx.getVariableType(indexDouble);
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
    this.ctx.setVariableType(value, propType);

    if (propTsType && propTsType !== 'string' && propTsType !== 'number' && propTsType !== 'boolean') {
      const interfaceInfoRaw = this.getKnownTypeProperties(propTsType);
      if (interfaceInfoRaw) {
        const interfaceInfo = interfaceInfoRaw as { keys: string[]; types: string[]; tsTypes: string[] };
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
    if (baseName.indexOf(' | ') !== -1) {
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
    const ast = this.ctx.getAst();
    if (!ast || !ast.interfaces) {
      return null;
    }
    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i];
      if (iface.name === interfaceName) {
        const keys: string[] = [];
        const types: string[] = [];
        const tsTypes: string[] = [];
        if (!iface.fields) {
          return { keys, types, tsTypes };
        }
        for (let j = 0; j < iface.fields.length; j++) {
          const f = iface.fields[j] as { name: string; type: string };
          keys.push(stripOptional(f.name));
          tsTypes.push(f.type);
          if (f.type === 'string') {
            types.push('i8*');
          } else if (f.type === 'number') {
            types.push('double');
          } else if (f.type === 'boolean') {
            types.push('double');
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
      const className = this.ctx.currentClassName;
      return className || null;
    }
    if (expr.type === 'variable') {
      const varName = (expr as VariableNode).name;
      const symbol = this.ctx.symbolTableLookup(varName);
      if (symbol && symbol.objectMetadata) {
        return symbol.interfaceType || null;
      }
      const paramType = this.getParameterTypeFromAST(varName);
      if (paramType) {
        return paramType;
      }
      return null;
    }
    if (expr.type === 'member_access') {
      const memberAccess = expr as MemberAccessNode;
      const memberAccessObjBase = memberAccess.object as ExprBase;
      if (memberAccessObjBase.type === 'this') {
        const className = this.ctx.currentClassName;
        if (className) {
          const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberAccess.property);
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
      const memberAccessObjBase = memberAccess.object as ExprBase;
      const arrayType = this.resolveMemberAccessType(memberAccess);
      if (arrayType && arrayType.endsWith('[]')) {
        const elementType = arrayType.slice(0, -2);
        const interfaceInfoRaw = this.getInterfaceInfo(elementType);
        if (interfaceInfoRaw) {
          const interfaceInfo = interfaceInfoRaw as { keys: string[]; types: string[]; tsTypes: string[] };
          return interfaceInfo;
        }
      }
      if (memberAccessObjBase.type === 'variable') {
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
                const f = fields[j] as { name: string; type: string };
                keys.push(stripOptional(f.name));
                tsTypes.push(f.type);
                if (f.type === 'string') {
                  types.push('i8*');
                } else if (f.type === 'number') {
                  types.push('double');
                } else if (f.type === 'boolean') {
                  types.push('double');
                } else {
                  types.push('i8*');
                }
              }
              return { keys, types, tsTypes };
            }
          }
        }
        const symbol = this.ctx.symbolTableLookup(varName);
        if (symbol && symbol.objectMetadata && symbol.objectMetadata.tsTypes) {
          const objMeta = symbol.objectMetadata;
          const objKeys = objMeta.keys;
          const objTsTypes = objMeta.tsTypes!;
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
                  const f = fields[j] as { name: string; type: string };
                  keys.push(stripOptional(f.name));
                  tsTypes.push(f.type);
                  if (f.type === 'string') {
                    types.push('i8*');
                  } else if (f.type === 'number') {
                    types.push('double');
                  } else if (f.type === 'boolean') {
                    types.push('double');
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
      const objArrayMeta = this.ctx.symbolTableGetObjectArrayMetadata(varName);
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
    const ast = this.ctx.getAst();
    if (!ast || !this.ctx.currentFunction) {
      return null;
    }
    for (let i = 0; i < ast.functions.length; i++) {
      const fn = ast.functions[i];
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
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
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
    if (interfaceName.startsWith('{') && interfaceName.endsWith('}')) {
      const inlineFields = this.parseInlineObjectTypeForAssertion(interfaceName);
      if (inlineFields) {
        for (let i = 0; i < inlineFields.length; i++) {
          const f = inlineFields[i];
          let fName = f.name;
          if (fName.endsWith('?')) {
            fName = fName.slice(0, -1);
          }
          if (fName === fieldName) {
            return f.type;
          }
        }
      }
      return null;
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.interfaces) {
      return null;
    }
    for (let i = 0; i < ast.interfaces.length; i++) {
      const iface = ast.interfaces[i];
      if (iface.name === interfaceName) {
        if (!iface.fields) continue;
        for (let j = 0; j < iface.fields.length; j++) {
          const f = iface.fields[j] as { name: string; type: string };
          let fName = f.name;
          if (fName.endsWith('?')) {
            fName = fName.slice(0, -1);
          }
          if (fName === fieldName) {
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
    const numValueDouble = this.ctx.nextTemp();
    this.ctx.emit(`${numValueDouble} = call double @cJSON_GetNumberValue(i8* ${fieldItem})`);
    const numAsStr = this.ctx.nextTemp();
    this.ctx.emit(`${numAsStr} = call i8* @__double_to_string(double ${numValueDouble})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${fieldEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i8* [ ${numAsStr}, %${numberLabel} ], [ ${strValue}, %${stringLabel} ]`);

    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private handleObjectPropertyAccess(expr: MemberAccessNode, params: string[]): string | null {
    let objPtr: string = '';
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
    if (exprObjType === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const isJSON = this.ctx.symbolTableIsJSON(varName);
      if (isJSON) {
        return null;
      }
      const isObject = this.ctx.symbolTableIsObject(varName);
      if (isObject) {
        const symbol = this.ctx.symbolTableLookup(varName);
        if (symbol?.interfaceType) {
          const ifaceType = symbol.interfaceType;
          const implementingClass = this.findClassImplementingInterface(ifaceType);
          if (implementingClass) {
            const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
            if (classFieldInfo) {
              const objPtrPtr = this.ctx.getVariableAlloca(varName)!;
              const objPtrRaw = this.ctx.nextTemp();
              this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${objPtrPtr}`);
              const castPtr = this.ctx.nextTemp();
              this.ctx.emit(`${castPtr} = bitcast i8* ${objPtrRaw} to %${implementingClass}_struct*`);
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`);
              return this.loadFieldValue(fieldPtr, classFieldInfo);
            }
          }
          if (this.ctx.interfaceStructGen && ifaceType && ifaceType.length > 0 && this.ctx.interfaceStructGen.hasInterface(ifaceType)) {
            const objPtrPtr = this.ctx.getVariableAlloca(varName)!;
            const objPtrRaw = this.ctx.nextTemp();
            this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${objPtrPtr}`);
            return this.accessObjectPropertyWithNamedInterface(objPtrRaw, expr.property, ifaceType);
          }
        }
      }
      // Try getObjectInfo regardless of isObject result - handles inline object literals
      const objMetaRaw = this.ctx.symbolTableGetObjectInfo(varName);
      if (objMetaRaw) {
        const objMeta = objMetaRaw as { ptr: string; keys: string[]; types: string[]; tsTypes: string[] | undefined };
        keys = objMeta.keys;
        types = objMeta.types;
        tsTypes = objMeta.tsTypes;
        const objPtrPtr = this.ctx.getVariableAlloca(varName)!;
        objPtr = this.ctx.nextTemp();
        this.ctx.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);
      }
    } else if (exprObjType === 'object') {
      const metadataResult = this.ctx.getObjectMetadata(expr.object as ObjectNode);
      const metadata = metadataResult as ObjectMetadata;
      keys = metadata.keys;
      types = metadata.types;
      objPtr = this.ctx.generateExpression(expr.object, params);
    } else if (exprObjType === 'method_call') {
      const result = this.handleMethodCallPropertyAccess(expr, params);
      if (result !== null) return result;
      return null;
    } else {
      return null;
    }

    if (keys.length === 0 || !objPtr) return null;

    const propIndex = keys.indexOf(expr.property);
    if (propIndex === -1) {
      const objDesc = exprObjType === 'variable' ? (expr.object as VariableNode).name : 'literal';
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
    this.ctx.setVariableType(value, propType);

    if (propTsType && propTsType !== 'string' && propTsType !== 'number' && propTsType !== 'boolean') {
      const interfaceInfoRaw = this.getKnownTypeProperties(propTsType);
      if (interfaceInfoRaw) {
        const interfaceInfo = interfaceInfoRaw as { keys: string[]; types: string[]; tsTypes: string[] };
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
    const methodCallObjBase = methodCall.object as ExprBase;
    if (methodCallObjBase.type !== 'variable') return null;
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
    const methodCallObjBase = methodCall.object as ExprBase;
    if (methodCallObjBase.type !== 'member_access') return null;

    const memberExpr = methodCall.object as MemberAccessNode;
    const memberExprObjBase = memberExpr.object as ExprBase;
    if (memberExprObjBase.type !== 'this') return null;
    if (!this.ctx.currentClassName) return null;

    const fieldInfoResult = this.ctx.classGenGetFieldInfo(this.ctx.currentClassName, memberExpr.property);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
    if (!fieldInfoResult || !fieldInfo.tsType) return null;

    const mapMatch = fieldInfo.tsType.match(/^Map<(\w+),\s*(.+)>$/);
    if (!mapMatch) return null;

    const valueType = mapMatch[2];
    const interfaceDefResult = this.getInterfaceDecl(valueType);
    if (!interfaceDefResult) return null;
    const interfaceDef = interfaceDefResult as InterfaceDeclaration;
    if (!interfaceDef.fields) return null;

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
    this.ctx.setVariableType(value, propType);

    return value;
  }

  private handleLengthProperty(expr: MemberAccessNode, params: string[]): string {
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase.type;
    if (exprObjType === null || exprObjType === undefined) {
      return '0.0';
    }
    if (exprObjType === 'variable' && this.ctx.symbolTableIsNumberArray((expr.object as VariableNode).name)) {
      return this.getArrayLength(expr.object, params, '%Array');
    }

    if (exprObjType === 'variable' && this.ctx.symbolTableIsObjectArray((expr.object as VariableNode).name)) {
      return this.getArrayLength(expr.object, params, '%ObjectArray');
    }

    if (this.isProcessArgvLength(expr)) {
      const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
      return this.getStringArrayLength(stringArrayPtr);
    }

    if (exprObjType === 'variable' && this.ctx.symbolTableIsStringArray((expr.object as VariableNode).name)) {
      const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
      return this.getStringArrayLength(stringArrayPtr);
    }

    if (exprObjType === 'member_access') {
      const result = this.handleMemberAccessLength(expr, params);
      if (result !== null) return result;
      const arrayPtr = this.ctx.generateExpression(expr.object, params);
      const arrayType = this.ctx.getVariableType(arrayPtr);
      if (arrayType === 'i8*') {
        return this.getStringLength(expr.object, params);
      }
      if (arrayType === '%StringArray*') {
        return this.getStringArrayLengthFromPtr(arrayPtr);
      }
      if (arrayType === '%Array*') {
        return this.getArrayLengthFromPtr(arrayPtr, '%Array');
      }
      return this.getArrayLengthFromPtr(arrayPtr, '%ObjectArray');
    }

    if (exprObjType === 'variable') {
      const objPtr = this.ctx.generateExpression(expr.object, params);
      const ptrType = this.ctx.getVariableType(objPtr);
      if (ptrType === '%StringArray*') {
        return this.getStringArrayLengthFromPtr(objPtr);
      }
      if (ptrType === '%Array*') {
        return this.getArrayLengthFromPtr(objPtr, '%Array');
      }
      if (ptrType === '%ObjectArray*') {
        return this.getArrayLengthFromPtr(objPtr, '%ObjectArray');
      }
    }

    return this.getStringLength(expr.object, params);
  }

  private isProcessArgvLength(expr: MemberAccessNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase.type;
    if (exprObjType === null || exprObjType === undefined) return false;
    if (exprObjType !== 'member_access') return false;
    const innerAccess = expr.object as MemberAccessNode;
    const innerAccessObjBase = innerAccess.object as ExprBase;
    return innerAccessObjBase.type === 'variable' &&
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
    this.ctx.setVariableType(len, 'double');
    return len;
  }

  private getStringArrayLength(stringArrayPtr: string): string {
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.setVariableType(len, 'double');
    return len;
  }

  private getStringArrayLengthFromPtr(ptr: string): string {
    const ptrType = this.ctx.getVariableType(ptr);
    let typedPtr = ptr;
    if (ptrType !== '%StringArray*') {
      typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${ptr} to %StringArray*`);
    }
    return this.getStringArrayLength(typedPtr);
  }

  private handleMemberAccessLength(expr: MemberAccessNode, params: string[]): string | null {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== 'member_access') return null;
    const innerAccess = expr.object as MemberAccessNode;

    const innerAccessObjBase = innerAccess.object as ExprBase;
    if (innerAccessObjBase.type === 'variable' && this.ctx.symbolTableIsClass((innerAccess.object as VariableNode).name)) {
      const classMeta = this.ctx.symbolTableGetClassInfo((innerAccess.object as VariableNode).name);
      if (classMeta) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(classMeta.className, innerAccess.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.type === 'string[]') {
          const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getStringArrayLength(stringArrayPtr);
        } else if (fieldInfoResult && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
          const arrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getArrayLengthFromPtr(arrayPtr, '%Array');
        } else if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.endsWith('[]')) {
          const arrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getArrayLengthFromPtr(arrayPtr, '%Array');
        }
      }
    } else if (innerAccessObjBase.type === 'variable') {
      const varName = (innerAccess.object as VariableNode).name;
      if (params.indexOf(varName) !== -1) {
        const paramInterfaceType = this.getParameterTypeFromAST(varName);
        if (paramInterfaceType) {
          const fieldType = this.getInterfaceFieldType(paramInterfaceType, innerAccess.property);
          if (fieldType) {
            if (fieldType === 'string[]') {
              const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
              return this.getStringArrayLength(stringArrayPtr);
            } else if (fieldType.endsWith('[]')) {
              const arrayPtr = this.ctx.generateExpression(expr.object, params);
              return this.getArrayLengthFromPtr(arrayPtr, '%ObjectArray');
            }
          }
        }
      }
      const symbol = this.ctx.symbolTableLookup(varName);
      if (symbol?.interfaceType) {
        const fieldType = this.getInterfaceFieldType(symbol.interfaceType, innerAccess.property);
        if (fieldType) {
          if (fieldType === 'string[]') {
            const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
            return this.getStringArrayLength(stringArrayPtr);
          } else if (fieldType.endsWith('[]')) {
            const arrayPtr = this.ctx.generateExpression(expr.object, params);
            return this.getArrayLengthFromPtr(arrayPtr, '%ObjectArray');
          }
        }
      }
      const arrayPtr = this.ctx.generateExpression(expr.object, params);
      const arrayType = this.ctx.getVariableType(arrayPtr);
      if (arrayType === '%StringArray*') {
        return this.getStringArrayLength(arrayPtr);
      } else if (arrayType === '%Array*') {
        return this.getArrayLengthFromPtr(arrayPtr, '%Array');
      } else if (arrayType === '%ObjectArray*') {
        return this.getArrayLengthFromPtr(arrayPtr, '%ObjectArray');
      }
      if (this.ctx.symbolTableIsJSON(varName) || this.ctx.symbolTableIsObject(varName)) {
        const arraySize = this.ctx.nextTemp();
        this.ctx.emit(`${arraySize} = call i32 @cJSON_GetArraySize(i8* ${arrayPtr})`);
        const sizeDouble = this.ctx.nextTemp();
        this.ctx.emit(`${sizeDouble} = sitofp i32 ${arraySize} to double`);
        this.ctx.setVariableType(sizeDouble, 'double');
        return sizeDouble;
      }
    } else if (innerAccessObjBase.type === 'this') {
      const className = this.ctx.currentClassName;
      if (className) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, innerAccess.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.type === 'string[]') {
          const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getStringArrayLength(stringArrayPtr);
        } else if (fieldInfoResult && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
          const arrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getArrayLengthFromPtr(arrayPtr, '%Array');
        } else if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.endsWith('[]')) {
          const arrayPtr = this.ctx.generateExpression(expr.object, params);
          return this.getArrayLengthFromPtr(arrayPtr, '%Array');
        }
      }
    } else if (innerAccessObjBase.type === 'member_access') {
      const arrayPtr = this.ctx.generateExpression(expr.object, params);
      const arrayType = this.ctx.getVariableType(arrayPtr);
      if (arrayType === '%StringArray*') {
        return this.getStringArrayLength(arrayPtr);
      } else if (arrayType === '%Array*') {
        return this.getArrayLengthFromPtr(arrayPtr, '%Array');
      } else if (arrayType === '%ObjectArray*') {
        return this.getArrayLengthFromPtr(arrayPtr, '%ObjectArray');
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
    this.ctx.setVariableType(len, 'double');
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
    this.ctx.setVariableType(len, 'double');
    return len;
  }

  private handleSizeProperty(expr: MemberAccessNode, params: string[]): string | null {
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase.type;
    if (exprObjType === null || exprObjType === undefined) {
      return null;
    }
    if (exprObjType === 'variable' && this.ctx.symbolTableIsMap((expr.object as VariableNode).name)) {
      const mapPtr = this.ctx.generateExpression(expr.object, params);
      this.ctx.syncStateToGenerators();
      return this.ctx.mapGen.generateMapSize(mapPtr);
    }
    if (exprObjType === 'variable' && this.ctx.symbolTableIsSet((expr.object as VariableNode).name)) {
      const setPtr = this.ctx.generateExpression(expr.object, params);
      this.ctx.syncStateToGenerators();
      return this.ctx.setGen.generateSetSize(setPtr);
    }
    if (exprObjType === 'member_access') {
      const innerAccess = expr.object as MemberAccessNode;
      const innerObjBase = innerAccess.object as ExprBase;
      if (innerObjBase.type === 'this' && this.ctx.currentClassName) {
        const fieldInfo = this.ctx.classGenGetFieldInfo(this.ctx.currentClassName, innerAccess.property);
        if (fieldInfo && fieldInfo.tsType) {
          const isMap = fieldInfo.tsType.startsWith('Map<') || fieldInfo.tsType.indexOf('Map<') !== -1;
          const isSet = fieldInfo.tsType.startsWith('Set<') || fieldInfo.tsType.indexOf('Set<') !== -1;
          if (isMap || isSet) {
            const ptr = this.ctx.generateExpression(expr.object, params);
            this.ctx.syncStateToGenerators();
            if (isSet) {
              return this.ctx.setGen.generateSetSize(ptr);
            } else {
              return this.ctx.mapGen.generateMapSize(ptr);
            }
          }
        }
      }
    }
    return null;
  }

  private handleResponseProperty(expr: MemberAccessNode): string | null {
    if (expr.property !== 'status' && expr.property !== 'ok') return null;
    const exprObjBase = expr.object as ExprBase;
    const exprObjType = exprObjBase.type;
    if (exprObjType === null || exprObjType === undefined) return null;
    if (exprObjType !== 'variable') return null;

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
    const prop = expr.property;
    if (!prop) {
      return '0.0';
    }
    if (prop.length === 0) {
      return '0.0';
    }
    const exprObjBase = expr.object as ExprBase;
    if (!exprObjBase) {
      return '0.0';
    }
    const exprObjType = exprObjBase.type;
    if (!exprObjType) {
      return '0.0';
    }
    if (exprObjType.length === 0) {
      return '0.0';
    }
    if (exprObjType !== 'variable') {
      if (exprObjType === 'member_access' || exprObjType === 'method_call' || exprObjType === 'index_access') {
        const innerPtr = this.ctx.generateExpression(expr.object, params);
        const innerType = this.ctx.getVariableType(innerPtr);
        if (innerType === 'i8*') {
          if (this.ctx.jsonObjectMetadata) {
            const metadataRaw = this.ctx.jsonObjectMetadata.get(innerPtr);
            if (metadataRaw) {
              const metadata = metadataRaw as { keys: string[]; types: string[]; tsTypes: string[] | undefined; interfaceType?: string };
              if (metadata.interfaceType && this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(metadata.interfaceType)) {
                return this.accessObjectPropertyWithNamedInterface(innerPtr, expr.property, metadata.interfaceType);
              }
              if (metadata.keys && metadata.types) {
                const propIndex = metadata.keys.indexOf(expr.property);
                if (propIndex !== -1) {
                  return this.accessObjectProperty(innerPtr, expr.property, metadata.keys, metadata.types, metadata.tsTypes);
                }
              }
            }
          }
          const structType = '{ i8* }';
          const typedPtr = this.ctx.nextTemp();
          this.ctx.emit(`${typedPtr} = bitcast i8* ${innerPtr} to ${structType}*`);
          const fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 0`);
          const value = this.ctx.nextTemp();
          this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
          this.ctx.setVariableType(value, 'i8*');
          return value;
        }
        if (innerType && innerType.startsWith('%') && innerType.endsWith('*')) {
          const innerTypeName = innerType.substring(1, innerType.length - 1);
          if (innerTypeName.endsWith('_struct')) {
            const className = innerTypeName.slice(0, -7);
            const fieldInfo = this.ctx.classGenGetFieldInfo(className, expr.property);
            if (fieldInfo) {
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${innerType.slice(0, -1)}, ${innerType} ${innerPtr}, i32 0, i32 ${fieldInfo.index}`);
              return this.loadFieldValue(fieldPtr, fieldInfo);
            }
          }
          const interfaceDefResult = this.getInterfaceFromAST(innerTypeName);
          if (interfaceDefResult) {
            const interfaceDef = interfaceDefResult as InterfaceInfo;
            const innerIfaceProps = interfaceDef.properties;
            if (!innerIfaceProps) {
              return innerPtr;
            }
            if (innerIfaceProps.length === 0) {
              return innerPtr;
            }
            let propIndex = -1;
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
                const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
                if (classFieldInfo) {
                  const castPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${castPtr} = bitcast %${innerTypeName}* ${innerPtr} to %${implementingClass}_struct*`);
                  const fieldPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`);
                  const fieldInfo: FieldInfo = {
                    index: classFieldInfo.index,
                    type: classFieldInfo.type,
                    tsType: classFieldInfo.tsType || propField.type
                  };
                  return this.loadFieldValue(fieldPtr, fieldInfo);
                }
              }
            }
          }
          return innerPtr;
        }
        return innerPtr;
      }
      return '0.0';
    }

    const varName = (expr.object as VariableNode).name;

    const symbol = this.ctx.symbolTableLookup(varName);
    if (symbol && symbol.kind === 'object' && symbol.objectMetadata) {
      return this.accessObjectWithMetadata(varName, expr.property, symbol.objectMetadata);
    }

    if (symbol && symbol.interfaceType && symbol.interfaceType.length > 0) {
      const varAlloca = this.ctx.getVariableAlloca(varName);
      if (varAlloca) {
        const objPtrRaw = this.ctx.nextTemp();
        this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${varAlloca}`);
        const ifaceType = symbol.interfaceType;
        if (this.ctx.interfaceStructGen && ifaceType && this.ctx.interfaceStructGen.hasInterface(ifaceType)) {
          return this.accessObjectPropertyWithNamedInterface(objPtrRaw, expr.property, ifaceType);
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
            let propIndex = -1;
            let propType = '';
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
                const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
                if (classFieldInfo) {
                  const castPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${castPtr} = bitcast i8* ${objPtrRaw} to %${implementingClass}_struct*`);
                  const fieldPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${castPtr}, i32 0, i32 ${classFieldInfo.index}`);
                  return this.loadFieldValue(fieldPtr, classFieldInfo);
                }
              }
              const structTypes: string[] = [];
              for (let i = 0; i < interfaceProps.length; i++) {
                const prop = interfaceProps[i] as InterfaceProperty;
                structTypes.push(this.interfaceTsTypeToLlvm(prop.type));
              }
              const structType = `{ ${structTypes.join(', ')} }`;
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`);
              const llvmFieldType = this.interfaceTsTypeToLlvm(propType);
              const value = this.ctx.nextTemp();
              if (propType === 'string' || propType.endsWith('[]') || propType.startsWith('%')) {
                this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                this.ctx.setVariableType(value, 'i8*');
              } else if (propType === 'number' || propType === 'boolean') {
                this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                this.ctx.setVariableType(value, 'double');
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
      if (paramInterfaceType) {
        if (paramInterfaceType.startsWith('{')) {
          const inlineFields = this.parseInlineObjectTypeForAssertion(paramInterfaceType);
          if (inlineFields) {
            let propIndex = -1;
            let propType = '';
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
                const structType = `{ ${structTypes.join(', ')} }`;
                const objPtrRaw = this.ctx.nextTemp();
                this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
                const objPtr = this.ctx.nextTemp();
                this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);
                const fieldPtr = this.ctx.nextTemp();
                this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`);
                const fieldInfo: FieldInfo = {
                  index: propIndex,
                  type: this.interfaceTsTypeToLlvm(propType),
                  tsType: propType
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
          if (!ifaceProps) {
            const fallbackAlloca = this.ctx.getVariableAlloca(varName);
            if (fallbackAlloca) {
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = load i8*, i8** ${fallbackAlloca}`);
              this.ctx.setVariableType(objPtr, 'i8*');
              return objPtr;
            }
            return '0.0';
          }
          if (ifaceProps.length === 0) {
            const fallbackAlloca = this.ctx.getVariableAlloca(varName);
            if (fallbackAlloca) {
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = load i8*, i8** ${fallbackAlloca}`);
              this.ctx.setVariableType(objPtr, 'i8*');
              return objPtr;
            }
            return '0.0';
          }
          let propIndex = -1;
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
                const classFieldInfo = this.ctx.classGenGetFieldInfo(implementingClass, expr.property);
                if (classFieldInfo) {
                  const classFieldInfoTyped = classFieldInfo as { index: number; type: string; tsType?: string };
                  const objPtrRaw = this.ctx.nextTemp();
                  this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
                  const objPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to %${implementingClass}_struct*`);
                  const fieldPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${implementingClass}_struct, %${implementingClass}_struct* ${objPtr}, i32 0, i32 ${classFieldInfoTyped.index}`);
                  if (classFieldInfoTyped.tsType) {
                    propType = classFieldInfoTyped.tsType;
                  }
                  const fieldInfo: FieldInfo = {
                    index: classFieldInfoTyped.index,
                    type: classFieldInfoTyped.type,
                    tsType: propType
                  };
                  return this.loadFieldValue(fieldPtr, fieldInfo);
                }
              }
              if (this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(paramInterfaceType)) {
                const objPtrRaw = this.ctx.nextTemp();
                this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
                return this.accessObjectPropertyWithNamedInterface(objPtrRaw, expr.property, paramInterfaceType);
              }
              const structTypes: string[] = [];
              for (let i = 0; i < ifaceProps.length; i++) {
                const prop = ifaceProps[i] as InterfaceProperty;
                structTypes.push(this.interfaceTsTypeToLlvm(prop.type));
              }
              const structType = `{ ${structTypes.join(', ')} }`;
              const objPtrRaw = this.ctx.nextTemp();
              this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${paramPtr}`);
              const objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`);
              const llvmFieldType = this.interfaceTsTypeToLlvm(propType);
              if (expr.property === 'nodePtr' || expr.property === 'treePtr') {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                this.ctx.setVariableType(value, 'i8*');
                return value;
              } else if (propType === 'string') {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                this.ctx.setVariableType(value, 'i8*');
                return value;
              } else if (propType === 'number') {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                this.ctx.setVariableType(value, 'double');
                return value;
              } else if (propType === 'boolean') {
                const boolVal = this.ctx.nextTemp();
                this.ctx.emit(`${boolVal} = load double, double* ${fieldPtr}`);
                this.ctx.setVariableType(boolVal, 'double');
                return boolVal;
              } else if (propType === 'string[]') {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
                this.ctx.setVariableType(value, '%StringArray*');
                return value;
              } else if (propType.endsWith('[]')) {
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
                this.ctx.setVariableType(value, '%Array*');
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
        this.ctx.setVariableType(objPtr, 'i8*');
        return objPtr;
      }
      return '0.0';
    }

    const fallbackAlloca = this.ctx.getVariableAlloca(varName);
    if (fallbackAlloca) {
      const objPtr = this.ctx.nextTemp();
      this.ctx.emit(`${objPtr} = load i8*, i8** ${fallbackAlloca}`);
      this.ctx.setVariableType(objPtr, 'i8*');
      return objPtr;
    }
    return '0.0';
  }

  private handleTypeAssertionPropertyAccess(
    expr: MemberAccessNode,
    params: string[]
  ): string | null {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== 'type_assertion') return null;

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
      if (this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(assertedType)) {
        const objPtr = this.ctx.generateExpression(assertion.expression, params);
        return this.accessObjectPropertyWithNamedInterface(objPtr, property, assertedType);
      }
      let interfaceDefResult: InterfaceDeclaration | null = null;
      const ast = this.ctx.getAst();
      if (ast?.interfaces) {
        for (let ii = 0; ii < ast.interfaces.length; ii++) {
          const iface = ast.interfaces[ii] as InterfaceDeclaration;
          if (iface.name === assertedType) {
            interfaceDefResult = iface;
            break;
          }
        }
      }
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
    this.ctx.setVariableType(value, fieldLlvmType);

    if (field.type && ['string', 'number', 'boolean'].indexOf(field.type) === -1 && !field.type.endsWith('[]')) {
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
    const parts = this.splitByTopLevelSemicolon(inner);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = this.findTopLevelColon(part);
      if (colonIdx === -1) continue;
      const name = part.slice(0, colonIdx).trim();
      const fieldType = part.slice(colonIdx + 1).trim();
      fields.push({ name, type: fieldType });
    }
    return fields;
  }

  private splitByTopLevelSemicolon(str: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < str.length; i++) {
      const char = str.charAt(i);
      if (char === '{' || char === '(' || char === '<' || char === '[') {
        depth++;
        current += char;
      } else if (char === '}' || char === ')' || char === '>' || char === ']') {
        depth--;
        current += char;
      } else if (char === ';' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      parts.push(current);
    }
    return parts;
  }

  private findTopLevelColon(str: string): number {
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charAt(i);
      if (char === '{' || char === '(' || char === '<' || char === '[') {
        depth++;
      } else if (char === '}' || char === ')' || char === '>' || char === ']') {
        depth--;
      } else if (char === ':' && depth === 0) {
        return i;
      }
    }
    return -1;
  }

  private accessObjectWithMetadata(varName: string, property: string, metadata: ObjectMetadata): string {
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
    this.ctx.setVariableType(value, propType);

    return value;
  }

  private accessInterfacePropertyWithNamedStruct(varName: string, property: string, interfaceType: string): string {
    const interfaceInfo = this.ctx.interfaceStructGen!.getInterfaceStruct(interfaceType);
    if (!interfaceInfo) {
      throw new Error(`Interface ${interfaceType} not found in interface struct generator`);
    }

    let propIndex = -1;
    let propLlvmType = '';
    let propTsType = '';
    const fields = interfaceInfo.fields as { name: string; tsType: string; llvmType: string }[];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] as { name: string; tsType: string; llvmType: string };
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
      throw new Error(this.ctx.formatCodegenError(
        `Property '${property}' not found on interface '${interfaceType}'. Available properties: ${fieldNames.join(', ')}`
      ));
    }

    const structType = `%${interfaceType}`;
    const varPtr = this.ctx.getVariableAlloca(varName);
    if (!varPtr) {
      throw new Error(`Variable ${varName} not found in symbol table`);
    }

    const objPtrRaw = this.ctx.nextTemp();
    this.ctx.emit(`${objPtrRaw} = load i8*, i8** ${varPtr}`);

    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = bitcast i8* ${objPtrRaw} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${objPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propLlvmType}, ${propLlvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, propLlvmType);

    if (propTsType && ['string', 'number', 'boolean'].indexOf(propTsType) === -1 && !propTsType.endsWith('[]')) {
      this.storeInterfaceMetadata(value, propTsType);
    }

    return value;
  }

  private accessObjectPropertyWithNamedInterface(objPtr: string, property: string, interfaceType: string): string {
    const interfaceInfo = this.ctx.interfaceStructGen!.getInterfaceStruct(interfaceType);
    if (!interfaceInfo) {
      throw new Error(`Interface ${interfaceType} not found in interface struct generator`);
    }

    let propIndex = -1;
    let propLlvmType = '';
    let propTsType = '';
    const fields = interfaceInfo.fields as { name: string; tsType: string; llvmType: string }[];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] as { name: string; tsType: string; llvmType: string };
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
      throw new Error(this.ctx.formatCodegenError(
        `Property '${property}' not found on interface '${interfaceType}'. Available properties: ${fieldNames.join(', ')}`
      ));
    }

    const structType = `%${interfaceType}`;
    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propLlvmType}, ${propLlvmType}* ${fieldPtr}`);
    this.ctx.setVariableType(value, propLlvmType);

    if (propTsType && ['string', 'number', 'boolean'].indexOf(propTsType) === -1 && !propTsType.endsWith('[]')) {
      this.storeInterfaceMetadata(value, propTsType);
    }

    return value;
  }

  private accessObjectProperty(objPtr: string, property: string, keys: string[], types: string[], _tsTypes?: string[]): string {
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
    this.ctx.setVariableType(value, propType);

    return value;
  }
}
