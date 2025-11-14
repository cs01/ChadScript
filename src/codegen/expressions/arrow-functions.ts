/**
 * Arrow Function Expression Generator
 *
 * Handles arrow function (lambda) expressions using lambda lifting:
 * Converts inline arrow functions to top-level functions.
 */

import { BaseGenerator } from '../infrastructure/base-generator';
import type { Expression, FunctionNode } from '../../types/ast';

export class ArrowFunctionExpressionGenerator extends BaseGenerator {
  // Counter for anonymous function names
  private anonFuncCounter = 0;

  // List of lifted functions to be added at the top level
  private liftedFunctions: FunctionNode[] = [];

  /**
   * Generate code for an arrow function expression.
   * Uses lambda lifting: converts inline function to top-level function.
   *
   * @param expr - The arrow function expression
   * @param params - Function parameters in scope
   * @returns Function name that can be referenced
   */
  generateArrowFunction(expr: any, params: string[]): string {
    const arrowFunc = expr;
    const funcName = `__lambda_${this.anonFuncCounter++}`;

    // Create a FunctionNode
    const liftedFunc: FunctionNode = {
      name: funcName,
      params: arrowFunc.params,
      body: arrowFunc.body.type === 'block' ? arrowFunc.body : {
        type: 'block',
        statements: [{ type: 'return', value: arrowFunc.body }]
      }
    };

    // Add to lifted functions list
    this.liftedFunctions.push(liftedFunc);

    // Return the function name as a variable reference
    // This allows it to be used with array methods
    return funcName;
  }

  /**
   * Get all lifted functions that need to be added at the top level.
   */
  getLiftedFunctions(): FunctionNode[] {
    return this.liftedFunctions;
  }

  /**
   * Clear lifted functions (used when starting a new function).
   */
  clearLiftedFunctions(): void {
    this.liftedFunctions = [];
  }

  /**
   * Reset the anonymous function counter.
   */
  resetCounter(): void {
    this.anonFuncCounter = 0;
  }
}
