import { Expression } from '../../../ast/types.js';

interface ControlFlowGeneratorLike {
  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string;
}

interface StringGeneratorLike {
  generateStringConcat(left: Expression, right: Expression, params: string[]): string;
}

export interface BinaryExpressionGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  syncStateToGenerators(): void;
  isStringExpression(expr: Expression): boolean;
  variableTypes: Map<string, string>;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  controlFlowGen: ControlFlowGeneratorLike;
  stringGen: StringGeneratorLike;
  generateExpression(expr: Expression, params: string[]): string;
}

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
  constructor(private ctx: BinaryExpressionGeneratorContext) {}

  generate(op: string, left: Expression, right: Expression, params: string[]): string {
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

    const leftValue = this.ctx.generateExpression(left, params);
    const rightValue = this.ctx.generateExpression(right, params);

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
    this.ctx.setVariableType(temp, 'double');
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
    this.ctx.setVariableType(resultDouble, 'double');
    return resultDouble;
  }

  private generateComparison(op: string, cond: string, leftValue: string, rightValue: string, leftExpr: Expression, rightExpr: Expression): string {
    // Check if we're comparing strings
    const leftIsString = this.ctx.isStringExpression(leftExpr);
    const rightIsString = this.ctx.isStringExpression(rightExpr);

    // Also check if generated values are tracked as strings
    const leftType = this.ctx.getVariableType(leftValue) || 'double';
    const rightType = this.ctx.getVariableType(rightValue) || 'double';
    const leftIsStringType = leftType === 'i8*' || leftValue.startsWith('@.str');
    const rightIsStringType = rightType === 'i8*' || rightValue.startsWith('@.str');

    // If one side is i32 (from JSON) and the other is a string, treat as string comparison
    const leftIsJSONi32 = leftType === 'i32';
    const rightIsJSONi32 = rightType === 'i32';

    // String comparison uses strcmp (check both static and runtime types)
    // Also treat as string comparison if one side is i32 (JSON) and the other is a string literal
    if ((op === '==' || op === '===' || op === '!=' || op === '!==') &&
        ((leftIsString || leftIsStringType) && (rightIsString || rightIsStringType) ||
         (leftIsJSONi32 && (rightIsString || rightIsStringType)) ||
         ((leftIsString || leftIsStringType) && rightIsJSONi32) ||
         (leftIsJSONi32 && rightIsJSONi32))) {
      return this.generateStringComparison(op, leftValue, rightValue);
    }

    // Numeric comparison uses fcmp
    return this.generateNumericComparison(cond, leftValue, rightValue);
  }

  private generateStringComparison(op: string, left: string, right: string): string {
    this.ctx.syncStateToGenerators();

    // Handle i32 values from JSON property access - convert to i8*
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    let leftPtr = left;
    let rightPtr = right;

    // If the type is i32 (from JSON phi), convert to i8*
    if (leftType === 'i32') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i32 ${left} to i8*`);
      leftPtr = temp;
    }

    if (rightType === 'i32') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i32 ${right} to i8*`);
      rightPtr = temp;
    }

    const strcmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${strcmpResult} = call i32 @strcmp(i8* ${leftPtr}, i8* ${rightPtr})`);

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
    this.ctx.setVariableType(extResult, 'double');
    return extResult;
  }

  private generateNumericComparison(cond: string, left: string, right: string): string {
    // Handle i32 values from JSON property access - convert to double
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    let leftDouble = left;
    let rightDouble = right;

    if (leftType === 'i32') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = sitofp i32 ${left} to double`);
      leftDouble = temp;
    }

    if (rightType === 'i32') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = sitofp i32 ${right} to double`);
      rightDouble = temp;
    }

    const cmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${cmpResult} = fcmp ${cond} double ${leftDouble}, ${rightDouble}`);

    // Convert boolean result to double (JavaScript semantics: comparisons return numbers)
    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(`${i32Result} = zext i1 ${cmpResult} to i32`);
    const doubleResult = this.ctx.nextTemp();
    this.ctx.emit(`${doubleResult} = sitofp i32 ${i32Result} to double`);
    this.ctx.setVariableType(doubleResult, 'double');
    return doubleResult;
  }
}
