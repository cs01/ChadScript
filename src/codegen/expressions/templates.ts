/**
 * Template Literal Expression Generator
 *
 * Handles template literal expressions: `Hello ${name}!`
 *
 * Generates:
 * - String constants for literal parts
 * - Expression evaluation for interpolated parts
 * - String concatenation to build the final result
 *
 * Examples:
 * - Empty template: `` -> empty string
 * - Simple string: `hello` -> string constant
 * - With interpolation: `Hello ${name}` -> concatenate "Hello " with name value
 */

import { Expression } from '../../ast/types.js';

export class TemplateLiteralGenerator {
  constructor(private ctx: any) {}

  // Helper methods delegate to context
  private get stringGen() { return this.ctx.stringGen; }

  /**
   * Generate code for template literal expression
   *
   * @example
   * Input: { type: 'template_literal', parts: ['Hello ', name, '!'] }
   * Output: result register with concatenated string
   */
  generate(expr: any, params: string[]): string {
    // Convert template literal to series of string concatenations
    // parts array contains strings and expressions interspersed
    if (expr.parts.length === 0) {
      // Empty template literal
      this.ctx.syncStateToGenerators();
      return this.stringGen.createStringConstant('');
    }

    if (expr.parts.length === 1 && typeof expr.parts[0] === 'string') {
      // Simple string with no interpolation
      this.ctx.syncStateToGenerators();
      return this.stringGen.createStringConstant(expr.parts[0]);
    }

    // Build result by concatenating parts
    this.ctx.syncStateToGenerators();
    let result: string | null = null;

    for (const part of expr.parts) {
      let partValue: string;

      if (typeof part === 'string') {
        // String literal part
        partValue = this.stringGen.createStringConstant(part);
      } else {
        // Expression part - need to convert to string
        // For now, we only support expressions that are already strings
        // TODO: Add number-to-string conversion
        partValue = this.ctx.generateExpression(part, params);
      }

      if (result === null) {
        result = partValue;
      } else {
        // Concatenate with previous result
        result = this.stringGen.generateStringConcatDirect(result, partValue);
      }
    }

    return result!;
  }
}
