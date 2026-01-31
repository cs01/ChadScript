/**
 * Conditional Expression Generator (Ternary Operator)
 *
 * Handles ternary conditional expressions: condition ? consequent : alternate
 *
 * Generates:
 * - Branch instructions based on condition
 * - True and false branches
 * - Phi node to merge results
 * - Type conversion if branches return different types
 */

import { Expression } from '../../ast/types.js';

export class ConditionalExpressionGenerator {
  constructor(private ctx: any) {}

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private get variableTypes() { return this.ctx.variableTypes; }

  /**
   * Generate code for conditional (ternary) expression
   *
   * @example
   * Input: { type: 'conditional', condition: ..., consequent: ..., alternate: ... }
   * Output: result register with value from true or false branch
   */
  generate(expr: any, params: string[]): string {
    // Generate unique labels
    const trueLabel = this.nextLabel('cond_true');
    const falseLabel = this.nextLabel('cond_false');
    const mergeLabel = this.nextLabel('cond_merge');

    // Evaluate condition
    const condValue = this.ctx.generateExpression(expr.condition, params);

    // Convert to boolean for branching
    const condValueType = this.ctx.getVariableType(condValue);
    let condBool: string;

    if (condValueType === 'double' || (condValue.includes('.') && !condValue.startsWith('%'))) {
      // Value is double, use fcmp directly
      condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condValue}, 0.0`);
    } else {
      // Value is i32, convert to double first
      const condDouble = this.nextTemp();
      this.emit(`${condDouble} = sitofp i32 ${condValue} to double`);
      condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condDouble}, 0.0`);
    }

    // Branch based on condition
    this.emit(`br i1 ${condBool}, label %${trueLabel}, label %${falseLabel}`);

    // True branch
    this.emit(`${trueLabel}:`);
    const trueValue = this.ctx.generateExpression(expr.consequent, params);
    // Track where we are after generating consequent (might have jumped to other blocks)
    const trueLabelEnd = this.ctx.getCurrentLabel();
    this.emit(`br label %${mergeLabel}`);

    // False branch
    this.emit(`${falseLabel}:`);
    const falseValue = this.ctx.generateExpression(expr.alternate, params);
    // Track where we are after generating alternate (might have jumped to other blocks)
    const falseLabelEnd = this.ctx.getCurrentLabel();
    this.emit(`br label %${mergeLabel}`);

    // Merge point with phi node
    this.emit(`${mergeLabel}:`);
    const result = this.nextTemp();

    // Determine the result type - use double if either value is double, i8* for strings
    const trueType = this.ctx.getVariableType(trueValue) || this.variableTypes.get(trueValue);
    const falseType = this.ctx.getVariableType(falseValue) || this.variableTypes.get(falseValue);
    let resultType: string;
    if (trueType === 'i8*' || falseType === 'i8*') {
      resultType = 'i8*';
    } else if (trueType === 'double' || falseType === 'double') {
      resultType = 'double';
    } else {
      resultType = 'i32';
    }

    // Convert values to match result type if needed
    let trueVal = trueValue;
    let falseVal = falseValue;

    if (resultType === 'double') {
      // Convert i32 values to double
      if (trueType === 'i32') {
        trueVal = this.nextTemp();
        this.emit(`${trueVal} = sitofp i32 ${trueValue} to double`);
      }
      if (falseType === 'i32') {
        falseVal = this.nextTemp();
        this.emit(`${falseVal} = sitofp i32 ${falseValue} to double`);
      }
    }

    this.emit(`${result} = phi ${resultType} [ ${trueVal}, %${trueLabelEnd} ], [ ${falseVal}, %${falseLabelEnd} ]`);
    this.variableTypes.set(result, resultType);

    return result;
  }
}
