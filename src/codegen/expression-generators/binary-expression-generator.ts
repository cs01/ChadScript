import { Expression } from '../../ast/types.js';

/**
 * BinaryExpressionGenerator
 *
 * Handles binary operations:
 * - Logical operators (&&, ||) with short-circuit evaluation
 * - String concatenation (+)
 * - Arithmetic operators (+, -, *, /, %)
 * - Bitwise operators (&, |, ^, <<, >>)
 * - Comparison operators (<, >, <=, >=, ==, !=, ===, !==)
 *   - String comparisons use strcmp
 *   - Numeric comparisons use fcmp
 */
export class BinaryExpressionGenerator {
  constructor(private ctx: any) {}

  generate(op: string, left: Expression, right: Expression, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // Logical operators need short-circuit evaluation
    if (op === '&&' || op === '||') {
      this.ctx.syncStateToGenerators();
      return this.ctx.controlFlowGen.generateLogicalOp(op, left, right, params);
    }

    // Check for string concatenation (+ with at least one string operand)
    if (op === '+' && (this.ctx.isStringExpression(left) || this.ctx.isStringExpression(right))) {
      this.ctx.syncStateToGenerators();
      return this.ctx.stringGen.generateStringConcat(left, right, params);
    }

    const leftValue = generateExpressionFn(left, params);
    const rightValue = generateExpressionFn(right, params);

    // Arithmetic operators (floating-point)
    const arithMap: { [key: string]: string } = {
      '+': 'fadd',
      '-': 'fsub',
      '*': 'fmul',
      '/': 'fdiv',
      '%': 'frem'
    };

    // Bitwise operators (need to convert double -> i64 -> operate -> double)
    const bitwiseMap: { [key: string]: string } = {
      '&': 'and',
      '|': 'or',
      '^': 'xor',
      '<<': 'shl',
      '>>': 'ashr'  // arithmetic shift right (preserves sign)
    };

    // Comparison operators (fcmp returns i1, need to extend to i32)
    const cmpMap: { [key: string]: string } = {
      '<': 'olt',   // ordered less than
      '>': 'ogt',   // ordered greater than
      '<=': 'ole',  // ordered less or equal
      '>=': 'oge',  // ordered greater or equal
      '==': 'oeq',  // ordered equal
      '!=': 'one',  // ordered not equal
      '===': 'oeq', // Strict equality (same as == for double)
      '!==': 'one'  // Strict inequality (same as != for double)
    };

    if (arithMap[op]) {
      return this.generateArithmetic(op, arithMap[op], leftValue, rightValue);
    } else if (bitwiseMap[op]) {
      return this.generateBitwise(op, bitwiseMap[op], leftValue, rightValue);
    } else if (cmpMap[op]) {
      return this.generateComparison(op, cmpMap[op], leftValue, rightValue, left, right);
    } else {
      throw new Error(`Unknown operator: ${op}`);
    }
  }

  private generateArithmetic(op: string, llvmOp: string, left: string, right: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = ${llvmOp} double ${left}, ${right}`);
    this.ctx.variableTypes.set(temp, 'double');
    return temp;
  }

  private generateBitwise(op: string, llvmOp: string, left: string, right: string): string {
    // Bitwise operators: convert double -> i64 -> operate -> double
    const leftInt = this.ctx.nextTemp();
    const rightInt = this.ctx.nextTemp();
    this.ctx.emit(`${leftInt} = fptosi double ${left} to i64`);
    this.ctx.emit(`${rightInt} = fptosi double ${right} to i64`);

    const resultInt = this.ctx.nextTemp();
    this.ctx.emit(`${resultInt} = ${llvmOp} i64 ${leftInt}, ${rightInt}`);

    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i64 ${resultInt} to double`);
    this.ctx.variableTypes.set(resultDouble, 'double');
    return resultDouble;
  }

  private generateComparison(op: string, cond: string, leftValue: string, rightValue: string, leftExpr: Expression, rightExpr: Expression): string {
    // Check if we're comparing strings
    const leftIsString = this.ctx.isStringExpression(leftExpr);
    const rightIsString = this.ctx.isStringExpression(rightExpr);

    // Also check if generated values are tracked as strings
    const leftType = this.ctx.variableTypes.get(leftValue) || 'i32';
    const rightType = this.ctx.variableTypes.get(rightValue) || 'i32';
    const leftIsStringType = leftType === 'i8*' || leftValue.startsWith('@.str');
    const rightIsStringType = rightType === 'i8*' || rightValue.startsWith('@.str');

    // String comparison uses strcmp (check both static and runtime types)
    if ((leftIsString || leftIsStringType) && (rightIsString || rightIsStringType) &&
        (op === '==' || op === '===' || op === '!=' || op === '!==')) {
      return this.generateStringComparison(op, leftValue, rightValue);
    }

    // Numeric comparison uses fcmp
    return this.generateNumericComparison(cond, leftValue, rightValue);
  }

  private generateStringComparison(op: string, left: string, right: string): string {
    this.ctx.syncStateToGenerators();
    const strcmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${strcmpResult} = call i32 @strcmp(i8* ${left}, i8* ${right})`);

    const cmpResult = this.ctx.nextTemp();
    if (op === '==' || op === '===') {
      this.ctx.emit(`${cmpResult} = icmp eq i32 ${strcmpResult}, 0`);
    } else { // '!=' or '!=='
      this.ctx.emit(`${cmpResult} = icmp ne i32 ${strcmpResult}, 0`);
    }

    // Convert boolean result to double
    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(`${i32Result} = zext i1 ${cmpResult} to i32`);
    const extResult = this.ctx.nextTemp();
    this.ctx.emit(`${extResult} = sitofp i32 ${i32Result} to double`);
    this.ctx.variableTypes.set(extResult, 'double');
    return extResult;
  }

  private generateNumericComparison(cond: string, left: string, right: string): string {
    const cmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${cmpResult} = fcmp ${cond} double ${left}, ${right}`);

    // Convert boolean result to double (JavaScript semantics: comparisons return numbers)
    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(`${i32Result} = zext i1 ${cmpResult} to i32`);
    const doubleResult = this.ctx.nextTemp();
    this.ctx.emit(`${doubleResult} = sitofp i32 ${i32Result} to double`);
    this.ctx.variableTypes.set(doubleResult, 'double');
    return doubleResult;
  }
}
