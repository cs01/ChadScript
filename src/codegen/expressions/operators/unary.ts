import { Expression, MemberAccessNode, VariableNode } from '../../../ast/types.js';

interface ExprBase { type: string; }

interface StringGenLike {
  createStringConstant(value: string): string;
}

interface ClassGeneratorLike {
  getFieldInfo(className: string, fieldName: string): { index: number; type: string; tsType?: string } | null;
  getClassFields(className: string): { name: string; fieldType: string }[];
  thisPointer?: string | null;
  currentClassName?: string | null;
}

interface UnaryExpressionContext {
  nextTemp(): string;
  emit(instruction: string): void;
  variableTypes: Map<string, string>;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  getVariableAlloca(name: string): string | undefined;
  thisPointer?: string | null;
  currentClassName?: string | null;
  classGen?: ClassGeneratorLike;
  classGenGetFieldInfo(className: string, fieldName: string): { index: number; type: string; tsType?: string } | null;
  stringGen?: StringGenLike;
  generateExpression(expr: Expression, params: string[]): string;
}

export class UnaryExpressionGenerator {
  constructor(private ctx: UnaryExpressionContext) {}

  generate(op: string, operand: Expression, params: string[]): string {
    if (op === 'post++' || op === 'post--') {
      return this.generatePostIncDec(op, operand, params);
    }

    if (op === '++' || op === '--') {
      return this.generatePreIncDec(op, operand, params);
    }

    const operandValue = this.ctx.generateExpression(operand, params);

    if (op === '!') {
      return this.generateLogicalNot(operandValue);
    }

    if (op === '-') {
      return this.generateNegation(operandValue);
    }

    if (op === '+') {
      return operandValue;
    }

    if (op === 'typeof') {
      return this.generateTypeof(operand, operandValue);
    }

    throw new Error(`Unknown unary operator: ${op}`);
  }

  private generatePostIncDec(op: string, operand: Expression, _params: string[]): string {
    if (operand.type === 'member_access') {
      return this.generateMemberAccessIncDec(op, operand as MemberAccessNode, true);
    }

    if (operand.type !== 'variable') {
      throw new Error(`Post-increment/decrement requires a variable operand`);
    }
    const operandVar = operand as { type: string; name: string };
    const varName = operandVar.name;
    const allocaReg = this.ctx.getVariableAlloca(varName);
    if (!allocaReg) {
      throw new Error(`Cannot find alloca for variable: ${varName}`);
    }

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${allocaReg}`);
    this.ctx.setVariableType(originalValue, 'double');

    const delta = op === 'post++' ? '1.0' : '-1.0';
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(`${newValue} = fadd double ${originalValue}, ${delta}`);

    this.ctx.emit(`store double ${newValue}, double* ${allocaReg}`);

    return originalValue;
  }

  private generatePreIncDec(op: string, operand: Expression, _params: string[]): string {
    if (operand.type === 'member_access') {
      return this.generateMemberAccessIncDec(op, operand as MemberAccessNode, false);
    }

    if (operand.type !== 'variable') {
      throw new Error(`Pre-increment/decrement requires a variable operand`);
    }
    const operandVarPre = operand as { type: string; name: string };
    const varName = operandVarPre.name;
    const allocaReg = this.ctx.getVariableAlloca(varName);
    if (!allocaReg) {
      throw new Error(`Cannot find alloca for variable: ${varName}`);
    }

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${allocaReg}`);

    const delta = op === '++' ? '1.0' : '-1.0';
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(`${newValue} = fadd double ${originalValue}, ${delta}`);
    this.ctx.setVariableType(newValue, 'double');

    this.ctx.emit(`store double ${newValue}, double* ${allocaReg}`);

    return newValue;
  }

  private generateLogicalNot(operand: string): string {
    const operandType = this.ctx.getVariableType(operand);
    let cmpResult: string;

    if (operandType === 'double' || (operand.indexOf('.') !== -1 && !operand.startsWith('%'))) {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = fcmp oeq double ${operand}, 0.0`);
    } else if (operandType && operandType.indexOf('*') !== -1) {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp eq ${operandType} ${operand}, null`);
    } else if (operandType === 'i32') {
      const operandDouble = this.ctx.nextTemp();
      this.ctx.emit(`${operandDouble} = sitofp i32 ${operand} to double`);
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = fcmp oeq double ${operandDouble}, 0.0`);
    } else {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = fcmp oeq double ${operand}, 0.0`);
    }

    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(`${i32Result} = zext i1 ${cmpResult} to i32`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = sitofp i32 ${i32Result} to double`);
    this.ctx.setVariableType(result, 'double');
    return result;
  }

  private generateNegation(operand: string): string {
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = fneg double ${operand}`);
    return result;
  }

  private generateMemberAccessIncDec(op: string, memberExpr: MemberAccessNode, isPost: boolean): string {
    const memberExprObjBase = memberExpr.object as ExprBase;
    if (memberExprObjBase.type !== 'this') {
      throw new Error(`Increment/decrement on member access only supported for 'this' fields`);
    }

    if (!this.ctx.thisPointer || !this.ctx.currentClassName || !this.ctx.classGen) {
      throw new Error(`this.field increment/decrement used outside of class method`);
    }

    const fieldName = memberExpr.property;
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(this.ctx.currentClassName, fieldName);
    if (!fieldInfoResult) {
      throw new Error(`Cannot find field '${fieldName}' in class ${this.ctx.currentClassName}`);
    }
    const fieldInfo = fieldInfoResult as { index: number; type: string };

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${this.ctx.currentClassName}_struct, %${this.ctx.currentClassName}_struct* ${this.ctx.thisPointer}, i32 0, i32 ${fieldInfo.index}`);

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${fieldPtr}`);
    this.ctx.setVariableType(originalValue, 'double');

    const isIncrement = op === 'post++' || op === '++';
    const delta = isIncrement ? '1.0' : '-1.0';
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(`${newValue} = fadd double ${originalValue}, ${delta}`);
    this.ctx.setVariableType(newValue, 'double');

    this.ctx.emit(`store double ${newValue}, double* ${fieldPtr}`);

    return isPost ? originalValue : newValue;
  }

  private generateTypeof(operand: Expression, operandValue: string): string {
    const operandType = this.ctx.getVariableType(operandValue);
    let typeString: string;

    if (operand.type === 'string') {
      typeString = 'string';
    } else if (operand.type === 'number') {
      typeString = 'number';
    } else if (operand.type === 'boolean') {
      typeString = 'boolean';
    } else if (operand.type === 'arrow_function') {
      typeString = 'function';
    } else if (operand.type === 'variable') {
      const varName = (operand as VariableNode).name;
      if (varName === 'undefined') {
        typeString = 'undefined';
      } else if (operandType === 'i8*' || (operandType && operandType.indexOf('*') !== -1)) {
        typeString = 'object';
      } else if (operandType === 'double') {
        typeString = 'number';
      } else {
        typeString = 'object';
      }
    } else if (operandType === 'i8*' || (operandType && operandType.indexOf('*') !== -1)) {
      typeString = 'object';
    } else {
      typeString = 'object';
    }

    if (!this.ctx.stringGen) {
      throw new Error('typeof requires stringGen in context');
    }
    const strPtr = this.ctx.stringGen.createStringConstant(typeString);
    this.ctx.setVariableType(strPtr, 'i8*');
    return strPtr;
  }
}
