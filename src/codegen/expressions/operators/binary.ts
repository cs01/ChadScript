import { Expression } from '../../../ast/types.js';

interface ControlFlowGeneratorLike {
  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string;
}

interface StringGeneratorLike {
  generateStringConcat(left: Expression, right: Expression, params: string[]): string;
}

export interface BinaryExpressionGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  getCurrentLabel(): string;
  emit(instruction: string): void;
  syncStateToGenerators(): void;
  isStringExpression(expr: Expression): boolean;
  variableTypes: Map<string, string>;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  controlFlowGen: ControlFlowGeneratorLike;
  stringGen: StringGeneratorLike;
  generateExpression(expr: Expression, params: string[]): string;
  stringGenGenerateStringConcat(left: Expression, right: Expression, params: string[]): string;
  controlFlowGenGenerateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string;
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
      return this.ctx.controlFlowGenGenerateLogicalOp(op, left, right, params);
    }

    // Check for string concatenation (+ with at least one string operand)
    if (op === '+' && (this.ctx.isStringExpression(left) || this.ctx.isStringExpression(right))) {
      this.ctx.syncStateToGenerators();
      return this.ctx.stringGenGenerateStringConcat(left, right, params);
    }

    const leftValue = this.ctx.generateExpression(left, params);
    const rightValue = this.ctx.generateExpression(right, params);

    // Arithmetic operators (floating-point)
    const arithMap: { [key: string]: string } = {
      '+': 'fadd',
      '-': 'fsub',
      '*': 'fmul',
      '/': 'fdiv'
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

    if (op === '%') {
      return this.generateModulo(leftValue, rightValue);
    } else if (arithMap[op]) {
      return this.generateArithmetic(op, arithMap[op], leftValue, rightValue);
    } else if (bitwiseMap[op]) {
      return this.generateBitwise(op, bitwiseMap[op], leftValue, rightValue);
    } else if (cmpMap[op]) {
      return this.generateComparison(op, cmpMap[op], leftValue, rightValue, left, right);
    } else {
      throw new Error(`Unknown operator: ${op}`);
    }
  }

  private generateArithmetic(_op: string, llvmOp: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    if (leftType === 'i8*' || (leftType && leftType.indexOf('*') !== -1)) {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = ptrtoint ${leftType} ${left} to i64`);
      const asDouble = this.ctx.nextTemp();
      this.ctx.emit(`${asDouble} = sitofp i64 ${asInt} to double`);
      left = asDouble;
    }

    if (rightType === 'i8*' || (rightType && rightType.indexOf('*') !== -1)) {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = ptrtoint ${rightType} ${right} to i64`);
      const asDouble = this.ctx.nextTemp();
      this.ctx.emit(`${asDouble} = sitofp i64 ${asInt} to double`);
      right = asDouble;
    }

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = ${llvmOp} double ${left}, ${right}`);
    this.ctx.setVariableType(temp, 'double');
    return temp;
  }

  private generateModulo(left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    if (leftType === 'i8*' || (leftType && leftType.indexOf('*') !== -1)) {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = ptrtoint ${leftType} ${left} to i64`);
      const asDouble = this.ctx.nextTemp();
      this.ctx.emit(`${asDouble} = sitofp i64 ${asInt} to double`);
      left = asDouble;
    }

    if (rightType === 'i8*' || (rightType && rightType.indexOf('*') !== -1)) {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = ptrtoint ${rightType} ${right} to i64`);
      const asDouble = this.ctx.nextTemp();
      this.ctx.emit(`${asDouble} = sitofp i64 ${asInt} to double`);
      right = asDouble;
    }

    const leftTrunc = this.ctx.nextTemp();
    this.ctx.emit(`${leftTrunc} = call double @llvm.trunc.f64(double ${left})`);
    const leftIsInt = this.ctx.nextTemp();
    this.ctx.emit(`${leftIsInt} = fcmp oeq double ${left}, ${leftTrunc}`);

    const rightTrunc = this.ctx.nextTemp();
    this.ctx.emit(`${rightTrunc} = call double @llvm.trunc.f64(double ${right})`);
    const rightIsInt = this.ctx.nextTemp();
    this.ctx.emit(`${rightIsInt} = fcmp oeq double ${right}, ${rightTrunc}`);

    const bothInt = this.ctx.nextTemp();
    this.ctx.emit(`${bothInt} = and i1 ${leftIsInt}, ${rightIsInt}`);

    const intModLabel = this.ctx.nextLabel('mod_int');
    const floatModLabel = this.ctx.nextLabel('mod_float');
    const mergeLabel = this.ctx.nextLabel('mod_merge');

    this.ctx.emit(`br i1 ${bothInt}, label %${intModLabel}, label %${floatModLabel}`);

    this.ctx.emit(`${intModLabel}:`);
    const leftInt = this.ctx.nextTemp();
    this.ctx.emit(`${leftInt} = fptosi double ${left} to i64`);
    const rightInt = this.ctx.nextTemp();
    this.ctx.emit(`${rightInt} = fptosi double ${right} to i64`);
    const sremResult = this.ctx.nextTemp();
    this.ctx.emit(`${sremResult} = srem i64 ${leftInt}, ${rightInt}`);
    const intResult = this.ctx.nextTemp();
    this.ctx.emit(`${intResult} = sitofp i64 ${sremResult} to double`);
    const intBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emit(`br label %${mergeLabel}`);

    this.ctx.emit(`${floatModLabel}:`);
    const fremResult = this.ctx.nextTemp();
    this.ctx.emit(`${fremResult} = frem double ${left}, ${right}`);
    const floatBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emit(`br label %${mergeLabel}`);

    this.ctx.emit(`${mergeLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi double [ ${intResult}, %${intBranchEnd} ], [ ${fremResult}, %${floatBranchEnd} ]`);
    this.ctx.setVariableType(result, 'double');
    return result;
  }

  private generateBitwise(_op: string, llvmOp: string, left: string, right: string): string {
    // Bitwise operators: convert double -> i64 -> operate -> double
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    const leftInt = this.ctx.nextTemp();
    if (leftType === 'i8*' || (leftType && leftType.indexOf('*') !== -1)) {
      this.ctx.emit(`${leftInt} = ptrtoint ${leftType} ${left} to i64`);
    } else {
      this.ctx.emit(`${leftInt} = fptosi double ${left} to i64`);
    }

    const rightInt = this.ctx.nextTemp();
    if (rightType === 'i8*' || (rightType && rightType.indexOf('*') !== -1)) {
      this.ctx.emit(`${rightInt} = ptrtoint ${rightType} ${right} to i64`);
    } else {
      this.ctx.emit(`${rightInt} = fptosi double ${right} to i64`);
    }

    const resultInt = this.ctx.nextTemp();
    this.ctx.emit(`${resultInt} = ${llvmOp} i64 ${leftInt}, ${rightInt}`);

    const resultDouble = this.ctx.nextTemp();
    this.ctx.emit(`${resultDouble} = sitofp i64 ${resultInt} to double`);
    this.ctx.setVariableType(resultDouble, 'double');
    return resultDouble;
  }

  private generateComparison(op: string, cond: string, leftValue: string, rightValue: string, leftExpr: Expression, rightExpr: Expression): string {
    const leftExprTyped = leftExpr as { type: string };
    const rightExprTyped = rightExpr as { type: string };
    const leftIsNullish = leftExprTyped.type === 'null' || leftExprTyped.type === 'undefined';
    const rightIsNullish = rightExprTyped.type === 'null' || rightExprTyped.type === 'undefined';
    if (leftIsNullish || rightIsNullish) {
      return this.generatePointerNullComparison(op, leftValue, rightValue);
    }

    const leftIsString = this.ctx.isStringExpression(leftExpr);
    const rightIsString = this.ctx.isStringExpression(rightExpr);

    const leftType = this.ctx.getVariableType(leftValue) || 'double';
    const rightType = this.ctx.getVariableType(rightValue) || 'double';
    const leftIsStringType = leftType === 'i8*' || leftValue.startsWith('@.str');
    const rightIsStringType = rightType === 'i8*' || rightValue.startsWith('@.str');

    const leftIsJSONi32 = leftType === 'i32';
    const rightIsJSONi32 = rightType === 'i32';

    const isStringOp = (leftIsString || leftIsStringType) && (rightIsString || rightIsStringType) ||
                       (leftIsJSONi32 && (rightIsString || rightIsStringType)) ||
                       ((leftIsString || leftIsStringType) && rightIsJSONi32) ||
                       (leftIsJSONi32 && rightIsJSONi32);

    if (isStringOp) {
      return this.generateStringComparison(op, leftValue, rightValue);
    }

    return this.generateNumericComparison(cond, leftValue, rightValue);
  }

  private generateStringComparison(op: string, left: string, right: string): string {
    this.ctx.syncStateToGenerators();

    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    let leftPtr = left;
    let rightPtr = right;

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

    const leftNull = this.ctx.nextTemp();
    this.ctx.emit(`${leftNull} = icmp eq i8* ${leftPtr}, null`);
    const rightNull = this.ctx.nextTemp();
    this.ctx.emit(`${rightNull} = icmp eq i8* ${rightPtr}, null`);
    const eitherNull = this.ctx.nextTemp();
    this.ctx.emit(`${eitherNull} = or i1 ${leftNull}, ${rightNull}`);

    const nullCheckLabel = this.ctx.nextLabel('strcmp_null_check');
    const strcmpLabel = this.ctx.nextLabel('strcmp_call');
    const mergeLabel = this.ctx.nextLabel('strcmp_merge');

    this.ctx.emit(`br i1 ${eitherNull}, label %${nullCheckLabel}, label %${strcmpLabel}`);

    this.ctx.emit(`${nullCheckLabel}:`);
    const bothNull = this.ctx.nextTemp();
    this.ctx.emit(`${bothNull} = and i1 ${leftNull}, ${rightNull}`);
    let nullResult: string;
    if (op === '==' || op === '===') {
      nullResult = bothNull;
    } else if (op === '!=' || op === '!==') {
      const notBothNull = this.ctx.nextTemp();
      this.ctx.emit(`${notBothNull} = xor i1 ${bothNull}, true`);
      nullResult = notBothNull;
    } else {
      const falseVal = this.ctx.nextTemp();
      this.ctx.emit(`${falseVal} = icmp eq i32 0, 1`);
      nullResult = falseVal;
    }
    const nullResultInt = this.ctx.nextTemp();
    this.ctx.emit(`${nullResultInt} = zext i1 ${nullResult} to i32`);
    const nullBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emit(`br label %${mergeLabel}`);

    this.ctx.emit(`${strcmpLabel}:`);
    const strcmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${strcmpResult} = call i32 @strcmp(i8* ${leftPtr}, i8* ${rightPtr})`);

    let cmpResult: string;
    if (op === '==' || op === '===') {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp eq i32 ${strcmpResult}, 0`);
    } else if (op === '!=' || op === '!==') {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp ne i32 ${strcmpResult}, 0`);
    } else if (op === '<') {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp slt i32 ${strcmpResult}, 0`);
    } else if (op === '>') {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp sgt i32 ${strcmpResult}, 0`);
    } else if (op === '<=') {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp sle i32 ${strcmpResult}, 0`);
    } else if (op === '>=') {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp sge i32 ${strcmpResult}, 0`);
    } else {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp eq i32 ${strcmpResult}, 0`);
    }
    const strcmpResultInt = this.ctx.nextTemp();
    this.ctx.emit(`${strcmpResultInt} = zext i1 ${cmpResult} to i32`);
    const strcmpBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emit(`br label %${mergeLabel}`);

    this.ctx.emit(`${mergeLabel}:`);
    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(`${i32Result} = phi i32 [ ${nullResultInt}, %${nullBranchEnd} ], [ ${strcmpResultInt}, %${strcmpBranchEnd} ]`);
    const extResult = this.ctx.nextTemp();
    this.ctx.emit(`${extResult} = sitofp i32 ${i32Result} to double`);
    this.ctx.setVariableType(extResult, 'double');
    return extResult;
  }

  private generateNumericComparison(cond: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    let leftDouble = left;
    let rightDouble = right;

    if (leftType === 'i32') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = sitofp i32 ${left} to double`);
      leftDouble = temp;
    } else if (leftType === 'i8*' || (leftType && leftType.indexOf('*') !== -1)) {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = ptrtoint ${leftType} ${left} to i64`);
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = sitofp i64 ${asInt} to double`);
      leftDouble = temp;
    }

    if (rightType === 'i32') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = sitofp i32 ${right} to double`);
      rightDouble = temp;
    } else if (rightType === 'i8*' || (rightType && rightType.indexOf('*') !== -1)) {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = ptrtoint ${rightType} ${right} to i64`);
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = sitofp i64 ${asInt} to double`);
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

  private generatePointerNullComparison(op: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left) || 'i8*';
    const rightType = this.ctx.getVariableType(right) || 'i8*';
    let leftPtr = left;
    let rightPtr = right;
    if (leftType !== 'i8*' && leftType.indexOf('*') !== -1) {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = bitcast ${leftType} ${left} to i8*`);
      leftPtr = temp;
    } else if (leftType === 'double') {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = bitcast double ${left} to i64`);
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i64 ${asInt} to i8*`);
      leftPtr = temp;
    }
    if (rightType !== 'i8*' && rightType.indexOf('*') !== -1) {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = bitcast ${rightType} ${right} to i8*`);
      rightPtr = temp;
    } else if (rightType === 'double') {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = bitcast double ${right} to i64`);
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i64 ${asInt} to i8*`);
      rightPtr = temp;
    }
    let cond = '';
    if (op === '==' || op === '===') {
      cond = 'eq';
    } else if (op === '!=' || op === '!==') {
      cond = 'ne';
    } else {
      cond = 'eq';
    }
    const cmpResult = this.ctx.nextTemp();
    this.ctx.emit(`${cmpResult} = icmp ${cond} i8* ${leftPtr}, ${rightPtr}`);
    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(`${i32Result} = zext i1 ${cmpResult} to i32`);
    const doubleResult = this.ctx.nextTemp();
    this.ctx.emit(`${doubleResult} = sitofp i32 ${i32Result} to double`);
    this.ctx.setVariableType(doubleResult, 'double');
    return doubleResult;
  }
}
