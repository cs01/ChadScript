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

import {
  Expression,
  TemplateLiteralNode,
  StringNode,
  BinaryNode,
  UnaryNode,
} from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";
import { emitFcmp, emitSelect } from "../infrastructure/ir-builders.js";
import {
  createStringConstant,
  convertNumberToString,
} from "../types/collections/string/constants.js";

function isComparisonOp(op: string): boolean {
  if (op === "===" || op === "!==" || op === "==" || op === "!=") return true;
  if (op === "<" || op === ">" || op === "<=" || op === ">=") return true;
  return false;
}

export class TemplateLiteralGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private booleanToString(boolValue: string): string {
    const trueStr = createStringConstant(this.ctx, "true");
    const falseStr = createStringConstant(this.ctx, "false");
    const varType = this.ctx.getVariableType(boolValue);
    if (varType === "i1") {
      return emitSelect(this.ctx, boolValue, "i8*", trueStr, falseStr);
    }
    let cmp: string;
    if (varType === "i64") {
      cmp = this.ctx.emitIcmp("ne", "i64", boolValue, "0");
    } else {
      cmp = emitFcmp(this.ctx, "one", boolValue, "0.0");
    }
    return emitSelect(this.ctx, cmp, "i8*", trueStr, falseStr);
  }

  private nullSafeString(strValue: string): string {
    const nullStr = createStringConstant(this.ctx, "null");
    const isNull = this.ctx.emitIcmp("eq", "i8*", strValue, "null");
    return emitSelect(this.ctx, isNull, "i8*", nullStr, strValue);
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
      return this.ctx.stringGen.doCreateStringConstant("");
    }

    if (expr.parts.length === 1) {
      const firstPart = expr.parts[0] as StringNode;
      if (firstPart.type === "string") {
        return this.ctx.stringGen.doCreateStringConstant(firstPart.value || "");
      }
    }

    // Build result by concatenating parts
    let result: string | null = null;

    for (let _tpi = 0; _tpi < expr.parts.length; _tpi++) {
      const part = expr.parts[_tpi];
      let partValue: string;

      const partAsObj = part as StringNode;
      if (partAsObj.type === "string") {
        partValue = this.ctx.stringGen.doCreateStringConstant(partAsObj.value || "");
      } else {
        const exprPart = part as Expression;
        const exprPartTyped = exprPart as { type: string };
        const exprValue = this.ctx.generateExpression(exprPart, params);
        const varType = this.ctx.getVariableType(exprValue);
        const isBoolExpr =
          exprPartTyped.type === "boolean" ||
          varType === "i1" ||
          (exprPartTyped.type === "binary" && isComparisonOp((exprPart as BinaryNode).op)) ||
          (exprPartTyped.type === "unary" && (exprPart as UnaryNode).op === "!");
        if (isBoolExpr) {
          partValue = this.booleanToString(exprValue);
        } else if (this.ctx.isStringExpression(exprPart) || varType === "i8*") {
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
