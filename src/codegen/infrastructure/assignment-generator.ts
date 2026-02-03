import {
  Expression,
  NewNode,
  VariableNode,
  MemberAccessAssignmentNode,
  AST,
  ClassNode,
  AssignmentStatement,
} from '../../ast/types.js';
import type { SymbolTable } from './symbol-table.js';

interface ClassGeneratorLike {
  getFieldInfo(className: string, property: string): FieldInfo | null;
  getClassFields(className: string): { name: string; llvmType: string }[];
}

interface FieldInfo {
  index: number;
  type: string;
  tsType?: string;
}

export interface AssignmentGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  getVariableAlloca(name: string): string | null;
  getVariableType(name: string): string | null;
  symbolTable: SymbolTable;
  classGen: ClassGeneratorLike;
  thisPointer: string | null;
  ast: AST;
  expectedArrayElementType: 'string' | 'number' | 'boolean' | null;
  currentDeclaredMapType: string | undefined;
  currentClassName: string | null;
}

export class AssignmentGenerator {
  constructor(private ctx: AssignmentGeneratorContext) {}

  generateMemberAccessAssignment(stmt: AssignmentStatement, params: string[]): void {
    if (stmt.value.type !== 'member_access_assignment') {
      throw new Error('Invalid member access assignment format');
    }
    const memberAccessValue = stmt.value as MemberAccessAssignmentNode;

    const object = memberAccessValue.object;
    const objectTyped = object as { type: string };
    const property = memberAccessValue.property;

    let className: string | null = null;

    if (objectTyped.type === 'variable') {
      const varName = (object as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(varName)!;
        className = classMeta.className;
      } else if (this.ctx.symbolTable.isObject(varName)) {
        this.handleObjectPropertyAssignment(object as VariableNode, property, memberAccessValue, params);
        return;
      }
    } else if (objectTyped.type === 'new') {
      const newExpr = object as NewNode;
      className = newExpr.className;
    } else if (objectTyped.type === 'this') {
      if (!this.ctx.thisPointer) {
        throw new Error('this.field = value used outside of class method or constructor');
      }
      className = this.ctx.currentClassName;
      if (!className) {
        let classWithFieldResult: ClassNode | null = null;
        for (let ci = 0; ci < this.ctx.ast.classes.length; ci++) {
          const c = this.ctx.ast.classes[ci] as ClassNode;
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
    }

    if (className) {
      this.handleClassFieldAssignment(object, className, property, memberAccessValue, params);
    }
  }

  private handleObjectPropertyAssignment(
    object: VariableNode,
    property: string,
    memberAccessValue: MemberAccessAssignmentNode,
    params: string[]
  ): void {
    const objMetaResult = this.ctx.symbolTable.getObjectInfo(object.name);
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
    let fieldInfoResult = this.ctx.classGen.getFieldInfo(className, property);
    const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };

    if (fieldInfoResult && fieldInfo.type === 'string[]') {
      this.ctx.expectedArrayElementType = 'string';
    } else if (fieldInfoResult && fieldInfo.type === 'number[]') {
      this.ctx.expectedArrayElementType = 'number';
    } else if (fieldInfoResult && fieldInfo.type === 'boolean[]') {
      this.ctx.expectedArrayElementType = 'boolean';
    }

    if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith('Map<string,')) {
      this.ctx.currentDeclaredMapType = fieldInfo.tsType;
    }

    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    this.ctx.expectedArrayElementType = null;
    this.ctx.currentDeclaredMapType = undefined;

    let instancePtr: string | null = null;
    if (object.type === 'variable') {
      const varName = (object as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        instancePtr = this.ctx.generateExpression(object, params);
      }
    } else if (object.type === 'new') {
      instancePtr = this.ctx.generateExpression(object, params);
    } else if (object.type === 'this') {
      instancePtr = this.ctx.thisPointer;
    }

    if (!instancePtr) {
      throw new Error(`Cannot determine class instance for field assignment on ${object.type}`);
    }

    const fields = this.ctx.classGen.getClassFields(className);

    if (fieldInfo) {
      const fi = fieldInfo as { index: number; type: string };
      const fieldPtr = this.ctx.nextTemp();
      if (fields.length > 0) {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fi.index}`);
        this.storeFieldValue(fieldInfo, fieldPtr, value, memberAccessValue);
      } else {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fi.index}`);
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

  private storeFieldValue(
    fieldInfo: FieldInfo,
    fieldPtr: string,
    value: string,
    memberAccessValue: MemberAccessAssignmentNode
  ): void {
    if (fieldInfo.type === 'string') {
      let isAlreadyPointer = false;
      if (memberAccessValue.value.type === 'variable') {
        const varType = this.ctx.getVariableType((memberAccessValue.value as VariableNode).name);
        if (varType === 'i8*' || (varType && varType.indexOf('*') !== -1)) {
          isAlreadyPointer = true;
        }
      } else if (memberAccessValue.value.type === 'string') {
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
    } else if (fieldInfo.type === 'string[]') {
      this.ctx.emit(`store %StringArray* ${value}, %StringArray** ${fieldPtr}`);
    } else if (fieldInfo.type.endsWith('[]')) {
      this.ctx.emit(`store %Array* ${value}, %Array** ${fieldPtr}`);
    } else if (fieldInfo.type === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = fcmp one double ${value}, 0.0`);
      this.ctx.emit(`store i1 ${boolValue}, i1* ${fieldPtr}`);
    } else if (fieldInfo.tsType?.startsWith('Map<string,')) {
      this.ctx.emit(`store %StringMap* ${value}, %StringMap** ${fieldPtr}`);
    } else if (fieldInfo.tsType?.startsWith('Map<')) {
      this.ctx.emit(`store %Map* ${value}, %Map** ${fieldPtr}`);
    } else if (fieldInfo.tsType === 'Set<string>') {
      this.ctx.emit(`store %StringSet* ${value}, %StringSet** ${fieldPtr}`);
    } else if (fieldInfo.tsType?.startsWith('Set<')) {
      this.ctx.emit(`store %Set* ${value}, %Set** ${fieldPtr}`);
    } else if (fieldInfo.tsType && fieldInfo.tsType !== 'number' && fieldInfo.tsType !== 'boolean') {
      this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
    } else {
      this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
    }
  }
}
