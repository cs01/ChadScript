import { Expression, NewNode } from '../../ast/types.js';

export interface AssignmentGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  getVariableAlloca(name: string): string | null;
  getVariableType(name: string): string | null;
  symbolTable: any;
  classGen: any;
  thisPointer: string | null;
  ast: any;
  expectedArrayElementType: 'string' | 'number' | 'boolean' | null;
}

export class AssignmentGenerator {
  constructor(private ctx: AssignmentGeneratorContext) {}

  generateMemberAccessAssignment(stmt: any, params: string[]): void {
    const memberAccessValue = stmt.value as any;
    if (memberAccessValue.type !== 'member_access_assignment') {
      throw new Error('Invalid member access assignment format');
    }

    const object = memberAccessValue.object;
    const property = memberAccessValue.property;

    let instancePtr: string | null = null;
    let className: string | null = null;

    if (object.type === 'variable' && this.ctx.symbolTable.isClass(object.name)) {
      const classMeta = this.ctx.symbolTable.getClassInfo(object.name)!;
      className = classMeta.className;
    } else if ((object as any).type === 'new') {
      const newExpr = object as any as NewNode;
      className = newExpr.className;
    } else if ((object as any).type === 'this') {
      if (!this.ctx.thisPointer) {
        throw new Error('this.field = value used outside of class method or constructor');
      }
      const classWithField = this.ctx.ast.classes.find((c: any) => true);
      if (classWithField) {
        className = classWithField.name;
      }
    } else if (object.type === 'variable' && this.ctx.symbolTable.isObject(object.name)) {
      this.handleObjectPropertyAssignment(object, property, memberAccessValue, params);
      return;
    }

    if (className) {
      this.handleClassFieldAssignment(object, className, property, memberAccessValue, params);
    }
  }

  private handleObjectPropertyAssignment(object: any, property: string, memberAccessValue: any, params: string[]): void {
    const objMeta = this.ctx.symbolTable.getObjectInfo(object.name);
    if (!objMeta) return;

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

  private handleClassFieldAssignment(object: any, className: string, property: string, memberAccessValue: any, params: string[]): void {
    let fieldInfo = this.ctx.classGen.getFieldInfo(className, property);

    if (fieldInfo && fieldInfo.type === 'string[]') {
      this.ctx.expectedArrayElementType = 'string';
    } else if (fieldInfo && fieldInfo.type === 'number[]') {
      this.ctx.expectedArrayElementType = 'number';
    } else if (fieldInfo && fieldInfo.type === 'boolean[]') {
      this.ctx.expectedArrayElementType = 'boolean';
    }

    const value = this.ctx.generateExpression(memberAccessValue.value, params);
    this.ctx.expectedArrayElementType = null;

    let instancePtr: string | null = null;
    if (object.type === 'variable' && this.ctx.symbolTable.isClass(object.name)) {
      instancePtr = this.ctx.generateExpression(object, params);
    } else if ((object as any).type === 'new') {
      instancePtr = this.ctx.generateExpression(object, params);
    } else if ((object as any).type === 'this') {
      instancePtr = this.ctx.thisPointer;
    } else {
      throw new Error(`Cannot assign to property of ${object.type}`);
    }

    if (!instancePtr) {
      throw new Error('Could not determine class instance for field assignment');
    }

    const fields = this.ctx.classGen.getClassFields(className);

    if (fieldInfo) {
      const fieldPtr = this.ctx.nextTemp();
      if (fields.length > 0) {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`);
        this.storeFieldValue(fieldInfo, fieldPtr, value, memberAccessValue);
      } else {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldInfo.index}`);
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

  private storeFieldValue(fieldInfo: any, fieldPtr: string, value: string, memberAccessValue: any): void {
    if (fieldInfo.type === 'string') {
      let isAlreadyPointer = false;
      if (memberAccessValue.value.type === 'variable') {
        const varType = this.ctx.getVariableType(memberAccessValue.value.name);
        if (varType === 'i8*' || varType?.includes('*')) {
          isAlreadyPointer = true;
        }
      } else if (memberAccessValue.value.type === 'string') {
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
    } else {
      this.ctx.emit(`store double ${value}, double* ${fieldPtr}`);
    }
  }
}
