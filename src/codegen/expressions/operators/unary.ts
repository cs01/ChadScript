import { Expression } from '../../../ast/types.js';

interface UnaryExpressionContext {
  nextTemp(): string;
  emit(instruction: string): void;
  variableTypes: Map<string, string>;
}

/**
 * UnaryExpressionGenerator
 *
 * Handles unary operations:
 * - ! (logical NOT)
 * - - (negation)
 * - + (unary plus, no-op)
 */
export class UnaryExpressionGenerator {
  constructor(private ctx: UnaryExpressionContext) {}

  generate(op: string, operand: Expression, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const operandValue = generateExpressionFn(operand, params);

    if (op === '!') {
      return this.generateLogicalNot(operandValue);
    }

    if (op === '-') {
      return this.generateNegation(operandValue);
    }

    if (op === '+') {
      // Unary + is a no-op for numbers, just return the operand
      return operandValue;
    }

    throw new Error(`Unknown unary operator: ${op}`);
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
