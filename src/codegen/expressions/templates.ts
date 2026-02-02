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

import { Expression, TemplateLiteralNode } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';
import { convertNumberToString } from '../types/collections/string/constants.js';

export class TemplateLiteralGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Generate code for template literal expression
   *
   * @example
   * Input: { type: 'template_literal', parts: ['Hello ', name, '!'] }
   * Output: result register with concatenated string
   */
  generate(expr: TemplateLiteralNode, params: string[]): string {
    // Convert template literal to series of string concatenations
    // parts array contains strings and expressions interspersed
    if (expr.parts.length === 0) {
      // Empty template literal
      this.ctx.syncStateToGenerators();
      return this.ctx.stringGen.createStringConstant('');
    }

    if (expr.parts.length === 1) {
      const firstPart = expr.parts[0] as { type: string };
      if (!firstPart.type) {
        // Simple string with no interpolation (no type property means it's a string)
        this.ctx.syncStateToGenerators();
        return this.ctx.stringGen.createStringConstant(expr.parts[0] as string);
      }
    }

    // Build result by concatenating parts
    this.ctx.syncStateToGenerators();
    let result: string | null = null;

    for (const part of expr.parts) {
      let partValue: string;

      const partAsObj = part as { type: string };
      if (!partAsObj.type) {
        // String literal part (no type property means it's a string)
        partValue = this.ctx.stringGen.createStringConstant(part as string);
      } else {
        const exprPart = part as Expression;
        const exprValue = this.ctx.generateExpression(exprPart, params);
        if (this.ctx.isStringExpression(exprPart) || this.ctx.getVariableType(exprValue) === 'i8*') {
          partValue = exprValue;
        } else {
          partValue = convertNumberToString(this.ctx, exprValue);
        }
      }

      if (result === null) {
        result = partValue;
      } else {
        // Concatenate with previous result
        result = this.ctx.stringGen.generateStringConcatDirect(result, partValue);
      }
    }

    return result!;
  }
}
