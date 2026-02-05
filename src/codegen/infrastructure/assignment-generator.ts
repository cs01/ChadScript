import {
  Expression,
  NewNode,
  VariableNode,
  MemberAccessAssignmentNode,
  MemberAccessNode,
  AST,
  ClassNode,
  AssignmentStatement,
} from '../../ast/types.js';
import type { SymbolTable, ClassInfo } from './symbol-table.js';
import type { InterfaceStructGenerator } from '../types/interface-struct-generator.js';

interface ClassGeneratorLike {
  getFieldInfo(className: string, property: string): FieldInfo | null;
  getClassFields(className: string): { name: string; llvmType: string }[];
  thisPointer?: string | null;
  currentClassName?: string | null;
}

interface FieldInfo {
  index: number;
  type: string;
  tsType?: string;
}

interface ObjectInfo {
  ptr: string;
  keys: string[];
  types: string[];
  tsTypes?: string[];
}

export interface AssignmentGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  getVariableAlloca(name: string): string | null;
  getVariableType(name: string): string | null;
  symbolTable: SymbolTable;
  symbolTableIsClass(name: string): boolean;
  symbolTableIsObject(name: string): boolean;
  symbolTableGetClassInfo(name: string): ClassInfo | undefined;
  symbolTableGetObjectInfo(name: string): ObjectInfo | undefined;
  classGen: ClassGeneratorLike;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  classGenGetClassFields(className: string): { name: string; llvmType: string }[];
  thisPointer: string | null;
  ast: AST;
  getAst(): AST | undefined;
  expectedArrayElementType: 'string' | 'number' | 'boolean' | 'pointer' | null;
  setExpectedArrayElementType(type: 'string' | 'number' | 'boolean' | 'pointer' | null): void;
  currentDeclaredMapType: string | undefined;
  setCurrentDeclaredMapType(type: string | undefined): void;
  currentClassName: string | null;
  getThisPointer(): string | null;
  getCurrentClassName(): string | null;
  interfaceStructGen?: InterfaceStructGenerator;
}

export class AssignmentGenerator {
  constructor(private ctx: AssignmentGeneratorContext) {}

  generateMemberAccessAssignment(stmt: AssignmentStatement, params: string[]): void {
    console.log('generateMemberAccessAssignment: start');
    const stmtValue = stmt.value;
    const stmtValueTyped = stmtValue as { type: string };
    const valueType = stmtValueTyped.type;
    console.log('generateMemberAccessAssignment: valueType = ' + valueType);
    if (valueType === null || valueType === undefined) {
      return;
    }
    if (valueType !== 'member_access_assignment') {
      throw new Error('Invalid member access assignment format');
    }
    const memberAccessValue = stmtValue as MemberAccessAssignmentNode;

    const object = memberAccessValue.object;
    const objectTyped = object as { type: string };
    const objType = objectTyped.type;
    console.log('generateMemberAccessAssignment: objType = ' + objType);
    if (objType === null || objType === undefined) {
      return;
    }
    const property = memberAccessValue.property;
    console.log('generateMemberAccessAssignment: property = ' + property);

    let className: string | null = null;

    if (objType === 'variable') {
      console.log('generateMemberAccessAssignment: variable branch');
      const varName = (object as VariableNode).name;
      if (this.ctx.symbolTableIsClass(varName)) {
        const classMeta = this.ctx.symbolTableGetClassInfo(varName)!;
        className = classMeta.className;
      } else if (this.ctx.symbolTableIsObject(varName)) {
        this.handleObjectPropertyAssignment(object as VariableNode, property, memberAccessValue, params);
        return;
      }
    } else if (objType === 'new') {
      console.log('generateMemberAccessAssignment: new branch');
      const newExpr = object as NewNode;
      className = newExpr.className;
    } else if (objType === 'this') {
      console.log('generateMemberAccessAssignment: this branch');
      const thisPtr = this.ctx.getThisPointer();
      console.log('generateMemberAccessAssignment: thisPtr = ' + thisPtr);
      if (!thisPtr) {
        throw new Error('this.field = value used outside of class method or constructor');
      }
      className = this.ctx.getCurrentClassName();
      console.log('generateMemberAccessAssignment: className = ' + className);
      if (!className) {
        const ast = this.ctx.getAst();
        const classes = ast?.classes || [];
        let classWithFieldResult: ClassNode | null = null;
        for (let ci = 0; ci < classes.length; ci++) {
          const c = classes[ci] as ClassNode;
          let hasField = false;
          for (let fi = 0; fi < c.fields.length; fi++) {
            const f = c.fields[fi] as { name: string };
            if (f.name === property) {
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
    } else if (objType === 'member_access' && property === 'length') {
      this.handleArrayLengthAssignment(object as MemberAccessNode, memberAccessValue, params);
      return;
    }

    if (className) {
      console.log('generateMemberAccessAssignment: calling handleClassFieldAssignment');
      this.handleClassFieldAssignment(object, className, property, memberAccessValue, params);
      console.log('generateMemberAccessAssignment: handleClassFieldAssignment done');
    }
  }

  private handleObjectPropertyAssignment(
    object: VariableNode,
    property: string,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[]
  ): void {
    const objMetaResult = this.ctx.symbolTableGetObjectInfo(object.name);
    if (!objMetaResult) return;
    const objMeta = objMetaResult as { ptr: string; keys: string[]; types: string[]; tsTypes: string[] };

    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    const propIndex = objMeta.keys.indexOf(property);
    if (propIndex === -1) {
      throw new Error(`Unknown property: ${property} on object ${object.name}. Available properties: ${objMeta.keys.join(', ')}`);
    }
    const propType = objMeta.types[propIndex];
    const structType = `{ ${objMeta.types.join(', ')} }`;

    const objPtrPtr = this.ctx.getVariableAlloca(object.name)!;
    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    if (propType === 'i1') {
      const boolVal = this.ctx.nextTemp();
      this.ctx.emit(`${boolVal} = fcmp one double ${value}, 0.0`);
      this.ctx.emit(`store i1 ${boolVal}, i1* ${fieldPtr}`);
    } else {
      this.ctx.emit(`store ${propType} ${value}, ${propType}* ${fieldPtr}`);
    }
  }

  private handleClassFieldAssignment(
    object: Expression,
    className: string,
    property: string,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[]
  ): void {
    console.log('handleClassFieldAssignment: entered');
    console.log('handleClassFieldAssignment: className=' + className + ', property=' + property);
    console.log('handleClassFieldAssignment: calling classGenGetFieldInfo');
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, property);
    console.log('handleClassFieldAssignment: got fieldInfoResult');

    let fieldIndex = -1;
    let fieldType = '';
    let fieldTsType: string | null = null;
    if (fieldInfoResult) {
      const fi = fieldInfoResult as { index: number; type: string; tsType?: string };
      fieldIndex = fi.index;
      fieldType = fi.type;
      if (fi.tsType !== null && fi.tsType !== undefined) {
        fieldTsType = fi.tsType;
      }
    }

    if (fieldInfoResult && fieldType === 'string[]') {
      this.ctx.setExpectedArrayElementType('string');
    } else if (fieldInfoResult && fieldType === 'number[]') {
      this.ctx.setExpectedArrayElementType('number');
    } else if (fieldInfoResult && fieldType === 'boolean[]') {
      this.ctx.setExpectedArrayElementType('boolean');
    }

    if (fieldTsType && fieldTsType.startsWith('Map<string,')) {
      this.ctx.setCurrentDeclaredMapType(fieldTsType);
    }

    console.log('handleClassFieldAssignment: calling generateExpression for value');
    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    console.log('handleClassFieldAssignment: got value=' + value);
    this.ctx.setExpectedArrayElementType(null);
    this.ctx.setCurrentDeclaredMapType(undefined);

    console.log('handleClassFieldAssignment: getting instancePtr');
    let instancePtr: string | null = null;
    const objType = object.type;
    if (objType === 'variable') {
      const varName = (object as VariableNode).name;
      if (this.ctx.symbolTableIsClass(varName)) {
        instancePtr = this.ctx.generateExpression(object, params);
      }
    } else if (objType === 'new') {
      instancePtr = this.ctx.generateExpression(object, params);
    } else if (objType === 'this') {
      instancePtr = this.ctx.getThisPointer();
    }

    if (!instancePtr) {
      throw new Error(`Cannot determine class instance for field assignment on ${objType}`);
    }

    const fields = this.ctx.classGenGetClassFields(className);

    if (fieldInfoResult) {
      const fieldPtr = this.ctx.nextTemp();
      if (fields.length > 0) {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldIndex}`);
        this.storeFieldValueDirect(fieldType, fieldTsType, fieldPtr, value, memberAccessValue);
      } else {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldIndex}`);
        this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
      }
    } else if (fields.length === 0) {
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 0`);
      this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
    } else {
      throw new Error(`Field '${property}' not found in class ${className}. Did you forget to declare it with a type annotation?`);
    }
  }

  private storeFieldValueDirect(
    fiType: string,
    fiTsType: string | null,
    fieldPtr: string,
    value: string,
    memberAccessValue: MemberAccessAssignmentNode
  ): void {
    if (fiType === null || fiType === undefined) {
      this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
      return;
    }

    const hasTsType = fiTsType !== null;

    if (fiType === 'string') {
      let isAlreadyPointer = false;
      const valueNodeType = memberAccessValue.value.type;
      if (valueNodeType === 'variable') {
        const varType = this.ctx.getVariableType((memberAccessValue.value as VariableNode).name);
        if (varType === 'i8*' || (varType && varType.indexOf('*') !== -1)) {
          isAlreadyPointer = true;
        }
      } else if (valueNodeType === 'string') {
        isAlreadyPointer = true;
      }

      const valueType = this.ctx.getVariableType(value);
      if (valueType === 'i8*' || (valueType && valueType.indexOf('*') !== -1)) {
        isAlreadyPointer = true;
      }

      if (isAlreadyPointer) {
        this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
      } else {
        const strPtr = this.ctx.nextTemp();
        this.ctx.emit(`${strPtr} = inttoptr i32 ${value} to i8*`);
        this.ctx.emit(`store i8* ${strPtr}, i8** ${fieldPtr}`);
      }
    } else if (fiType === 'string[]') {
      this.ctx.emit(`store %StringArray* ${value}, %StringArray** ${fieldPtr}`);
    } else if (fiType.endsWith('[]')) {
      this.ctx.emit(`store %Array* ${value}, %Array** ${fieldPtr}`);
    } else if (fiType === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = fcmp one double ${value}, 0.0`);
      this.ctx.emit(`store i1 ${boolValue}, i1* ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith('Map<string,')) {
      this.ctx.emit(`store %StringMap* ${value}, %StringMap** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith('Map<')) {
      this.ctx.emit(`store %Map* ${value}, %Map** ${fieldPtr}`);
    } else if (hasTsType && fiTsType === 'Set<string>') {
      this.ctx.emit(`store %StringSet* ${value}, %StringSet** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith('Set<')) {
      this.ctx.emit(`store %Set* ${value}, %Set** ${fieldPtr}`);
    } else if (hasTsType && fiTsType !== 'number' && fiTsType !== 'boolean') {
      this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
    } else {
      this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
    }
  }

  private storeFieldValue(
    fieldInfo: FieldInfo,
    fieldPtr: string,
    value: string,
    memberAccessValue: MemberAccessAssignmentNode
  ): void {
    const fi = fieldInfo as { type: string; tsType?: string };
    const fiType = fi.type;

    if (fiType === null || fiType === undefined) {
      this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
      return;
    }

    const fiTsType = fi.tsType;
    const hasTsType = fiTsType !== null && fiTsType !== undefined;

    if (fiType === 'string') {
      let isAlreadyPointer = false;
      const valueNodeType = memberAccessValue.value.type;
      if (valueNodeType === 'variable') {
        const varType = this.ctx.getVariableType((memberAccessValue.value as VariableNode).name);
        if (varType === 'i8*' || (varType && varType.indexOf('*') !== -1)) {
          isAlreadyPointer = true;
        }
      } else if (valueNodeType === 'string') {
        isAlreadyPointer = true;
      }

      const valueType = this.ctx.getVariableType(value);
      if (valueType === 'i8*' || (valueType && valueType.indexOf('*') !== -1)) {
        isAlreadyPointer = true;
      }

      if (isAlreadyPointer) {
        this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
      } else {
        const strPtr = this.ctx.nextTemp();
        this.ctx.emit(`${strPtr} = inttoptr i32 ${value} to i8*`);
        this.ctx.emit(`store i8* ${strPtr}, i8** ${fieldPtr}`);
      }
    } else if (fiType === 'string[]') {
      this.ctx.emit(`store %StringArray* ${value}, %StringArray** ${fieldPtr}`);
    } else if (fiType.endsWith('[]')) {
      this.ctx.emit(`store %Array* ${value}, %Array** ${fieldPtr}`);
    } else if (fiType === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = fcmp one double ${value}, 0.0`);
      this.ctx.emit(`store i1 ${boolValue}, i1* ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith('Map<string,')) {
      this.ctx.emit(`store %StringMap* ${value}, %StringMap** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith('Map<')) {
      this.ctx.emit(`store %Map* ${value}, %Map** ${fieldPtr}`);
    } else if (hasTsType && fiTsType === 'Set<string>') {
      this.ctx.emit(`store %StringSet* ${value}, %StringSet** ${fieldPtr}`);
    } else if (hasTsType && fiTsType && fiTsType.startsWith('Set<')) {
      this.ctx.emit(`store %Set* ${value}, %Set** ${fieldPtr}`);
    } else if (hasTsType && fiTsType !== 'number' && fiTsType !== 'boolean') {
      this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
    } else {
      this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
    }
  }

  private handleArrayLengthAssignment(
    arrayExpr: MemberAccessNode,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[]
  ): void {
    const arrayPtr = this.ctx.generateExpression(arrayExpr, params);
    const value = this.ctx.generateExpression(memberAccessValue.value, params);

    const valueI32 = this.ctx.nextTemp();
    this.ctx.emit(`${valueI32} = fptosi double ${value} to i32`);

    let arrayType = '%StringArray';
    const currentClass = this.ctx.getCurrentClassName();
    if (arrayExpr.object.type === 'this' && currentClass) {
      const fieldInfo = this.ctx.classGenGetFieldInfo(currentClass, arrayExpr.property);
      if (fieldInfo) {
        const fi = fieldInfo as { type: string };
        if (fi.type === 'string[]') {
          arrayType = '%StringArray';
        } else if (fi.type.endsWith('[]')) {
          arrayType = '%Array';
        }
      }
    }

    const lengthPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lengthPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`);
    this.ctx.emit(`store i32 ${valueI32}, i32* ${lengthPtr}`);
  }
}
