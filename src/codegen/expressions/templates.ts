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
import { createStringConstant, convertNumberToString } from '../types/collections/string/constants.js';

export class TemplateLiteralGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private booleanToString(boolValue: string): string {
    const trueStr = createStringConstant(this.ctx, 'true');
    const falseStr = createStringConstant(this.ctx, 'false');
    const cmp = this.ctx.nextTemp();
    this.ctx.emit(`${cmp} = fcmp one double ${boolValue}, 0.0`);
    const selected = this.ctx.nextTemp();
    this.ctx.emit(`${selected} = select i1 ${cmp}, i8* ${trueStr}, i8* ${falseStr}`);
    return selected;
  }

  private nullSafeString(strValue: string): string {
    const nullStr = createStringConstant(this.ctx, 'null');
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${strValue}, null`);
    const safe = this.ctx.nextTemp();
    this.ctx.emit(`${safe} = select i1 ${isNull}, i8* ${nullStr}, i8* ${strValue}`);
    return safe;
  }

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
      return this.ctx.stringGen.doCreateStringConstant('');
    }

    if (expr.parts.length === 1) {
      const firstPart = expr.parts[0] as { type: string; value?: string };
      if (firstPart.type === 'string') {
        return this.ctx.stringGen.doCreateStringConstant(firstPart.value || '');
      }
    }

    // Build result by concatenating parts
    let result: string | null = null;

    for (let _tpi = 0; _tpi < expr.parts.length; _tpi++) {
      const part = expr.parts[_tpi];
      let partValue: string;

      const partAsObj = part as { type: string; value?: string };
      if (partAsObj.type === 'string') {
        partValue = this.ctx.stringGen.doCreateStringConstant(partAsObj.value || '');
      } else {
        const exprPart = part as Expression;
        const exprPartObj = exprPart as { type: string };
        const exprValue = this.ctx.generateExpression(exprPart, params);
        if (exprPartObj.type === 'boolean') {
          partValue = this.booleanToString(exprValue);
        } else if (this.ctx.isStringExpression(exprPart) || this.ctx.getVariableType(exprValue) === 'i8*') {
          partValue = this.nullSafeString(exprValue);
        } else {
          partValue = convertNumberToString(this.ctx, exprValue);
        }
      }

      if (result === null) {
        result = partValue;
      } else {
        result = this.ctx.stringGen.doGenerateStringConcatDirect(result, partValue);
      }
    }

    return result!;
  }
}
