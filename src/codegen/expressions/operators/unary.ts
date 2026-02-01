import { Expression } from '../../../ast/types.js';

interface UnaryExpressionContext {
  nextTemp(): string;
  emit(instruction: string): void;
  variableTypes: Map<string, string>;
  getVariableAlloca(name: string): string | undefined;
}

export class UnaryExpressionGenerator {
  constructor(private ctx: UnaryExpressionContext) {}

  generate(op: string, operand: Expression, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (op === 'post++' || op === 'post--') {
      return this.generatePostIncDec(op, operand, params, generateExpressionFn);
    }

    if (op === '++' || op === '--') {
      return this.generatePreIncDec(op, operand, params, generateExpressionFn);
    }

    const operandValue = generateExpressionFn(operand, params);

    if (op === '!') {
      return this.generateLogicalNot(operandValue);
    }

    if (op === '-') {
      return this.generateNegation(operandValue);
    }

    if (op === '+') {
      return operandValue;
    }

    throw new Error(`Unknown unary operator: ${op}`);
  }

  private generatePostIncDec(op: string, operand: Expression, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (operand.type !== 'variable') {
      throw new Error(`Post-increment/decrement requires a variable operand`);
    }
    const varName = operand.name;
    const allocaReg = this.ctx.getVariableAlloca(varName);
    if (!allocaReg) {
      throw new Error(`Cannot find alloca for variable: ${varName}`);
    }

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${allocaReg}`);
    this.ctx.variableTypes.set(originalValue, 'double');

    const delta = op === 'post++' ? '1.0' : '-1.0';
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(`${newValue} = fadd double ${originalValue}, ${delta}`);

    this.ctx.emit(`store double ${newValue}, double* ${allocaReg}`);

    return originalValue;
  }

  private generatePreIncDec(op: string, operand: Expression, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (operand.type !== 'variable') {
      throw new Error(`Pre-increment/decrement requires a variable operand`);
    }
    const varName = operand.name;
    const allocaReg = this.ctx.getVariableAlloca(varName);
    if (!allocaReg) {
      throw new Error(`Cannot find alloca for variable: ${varName}`);
    }

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${allocaReg}`);

    const delta = op === '++' ? '1.0' : '-1.0';
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(`${newValue} = fadd double ${originalValue}, ${delta}`);
    this.ctx.variableTypes.set(newValue, 'double');

    this.ctx.emit(`store double ${newValue}, double* ${allocaReg}`);

    return newValue;
  }

  private generateLogicalNot(operand: string): string {
    // Check if operand is double or i32
    const operandType = this.ctx.variableTypes.get(operand);
    let cmpResult: string;

    if (operandType === 'double' || (operand.includes('.') && !operand.startsWith('%'))) {
      // Operand is double, use fcmp directly
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = fcmp oeq double ${operand}, 0.0`);
    } else {
      // Operand is i32, convert to double first
      const operandDouble = this.ctx.nextTemp();
      this.ctx.emit(`${operandDouble} = sitofp i32 ${operand} to double`);
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = fcmp oeq double ${operandDouble}, 0.0`);
    }

    // Convert boolean result to double
    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(`${i32Result} = zext i1 ${cmpResult} to i32`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = sitofp i32 ${i32Result} to double`);
    this.ctx.variableTypes.set(result, 'double');
    return result;
  }

  private generateNegation(operand: string): string {
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = fneg double ${operand}`);
    return result;
  }
}
