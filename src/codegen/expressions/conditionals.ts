/**
 * Conditional Expression Generator (Ternary Operator)
 *
 * Handles ternary conditional expressions: condition ? consequent : alternate
 *
 * Generates:
 * - Branch instructions based on condition
 * - True and false branches with conversion landing blocks
 * - Phi node to merge results
 */

import { ConditionalExpressionNode, Expression, ArrayNode } from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";

export class ConditionalExpressionGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private nextLabel(prefix: string): string {
    return this.ctx.nextLabel(prefix);
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  generate(expr: ConditionalExpressionNode, params: string[]): string {
    const trueLabel = this.nextLabel("cond_true");
    const falseLabel = this.nextLabel("cond_false");
    const trueConvLabel = this.nextLabel("true_conv");
    const falseConvLabel = this.nextLabel("false_conv");
    const mergeLabel = this.nextLabel("cond_merge");

    const condValue = this.ctx.generateExpression(expr.condition, params);
    const condValueType = this.ctx.getVariableType(condValue);
    let condBool: string;

    if (
      condValueType === "double" ||
      (condValue.indexOf(".") !== -1 && !condValue.startsWith("%"))
    ) {
      condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condValue}, 0.0`);
    } else if (condValueType && condValueType.indexOf("*") !== -1) {
      condBool = this.nextTemp();
      this.emit(`${condBool} = icmp ne ${condValueType} ${condValue}, null`);
    } else if (condValueType === "i1") {
      condBool = condValue;
    } else if (condValueType === "i32") {
      const condDouble = this.nextTemp();
      this.emit(`${condDouble} = sitofp i32 ${condValue} to double`);
      condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condDouble}, 0.0`);
    } else if (condValueType === "i64") {
      condBool = this.nextTemp();
      this.emit(`${condBool} = icmp ne i64 ${condValue}, 0`);
    } else {
      condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condValue}, 0.0`);
    }

    this.emit(`br i1 ${condBool}, label %${trueLabel}, label %${falseLabel}`);

    this.emit(`${trueLabel}:`);
    const trueValue = this.ctx.generateExpression(expr.consequent, params);
    const trueType = this.ctx.getVariableType(trueValue);
    this.emit(`br label %${trueConvLabel}`);

    this.emit(`${falseLabel}:`);
    const savedExpectedType = this.ctx.getExpectedArrayElementType();
    const falseExprTyped = expr.alternate as ArrayNode;
    if (
      falseExprTyped.type === "array" &&
      (!falseExprTyped.elements || falseExprTyped.elements.length === 0)
    ) {
      if (savedExpectedType === null) {
        if (trueType === "%StringArray*") {
          this.ctx.setExpectedArrayElementType("string");
        } else if (trueType === "%ObjectArray*") {
          this.ctx.setExpectedArrayElementType("pointer");
        }
      }
    }
    const falseValue = this.ctx.generateExpression(expr.alternate, params);
    this.ctx.setExpectedArrayElementType(savedExpectedType);
    const falseType = this.ctx.getVariableType(falseValue);
    this.emit(`br label %${falseConvLabel}`);

    const trueIsPtr = trueType && trueType.indexOf("*") !== -1;
    const falseIsPtr = falseType && falseType.indexOf("*") !== -1;

    let resultType: string;
    if (trueIsPtr || falseIsPtr) {
      if (trueType === falseType) {
        resultType = trueType!;
      } else {
        resultType = "i8*";
      }
    } else if (trueType === "i8*" || falseType === "i8*") {
      resultType = "i8*";
    } else if (trueType === "double" || falseType === "double") {
      resultType = "double";
    } else if (trueType === "i64" || falseType === "i64") {
      resultType = "i64";
    } else {
      resultType = "i32";
    }

    this.emit(`${trueConvLabel}:`);
    let trueVal = trueValue;
    if (resultType === "double" && trueType === "i32") {
      trueVal = this.nextTemp();
      this.emit(`${trueVal} = sitofp i32 ${trueValue} to double`);
    } else if (resultType === "double" && trueType === "i64") {
      trueVal = this.nextTemp();
      this.emit(`${trueVal} = sitofp i64 ${trueValue} to double`);
    } else if (resultType === "i8*" && trueType === "double") {
      trueVal = this.nextTemp();
      this.emit(`${trueVal} = call i8* @__double_to_string(double ${trueValue})`);
    } else if (resultType === "i8*" && trueType === "i32") {
      const asDouble = this.nextTemp();
      this.emit(`${asDouble} = sitofp i32 ${trueValue} to double`);
      trueVal = this.nextTemp();
      this.emit(`${trueVal} = call i8* @__double_to_string(double ${asDouble})`);
    } else if (resultType === "i8*" && trueType === "i64") {
      const asDouble = this.nextTemp();
      this.emit(`${asDouble} = sitofp i64 ${trueValue} to double`);
      trueVal = this.nextTemp();
      this.emit(`${trueVal} = call i8* @__double_to_string(double ${asDouble})`);
    } else if (
      resultType === "i8*" &&
      trueType &&
      trueType !== "i8*" &&
      trueType.indexOf("*") !== -1
    ) {
      trueVal = this.nextTemp();
      this.emit(`${trueVal} = bitcast ${trueType} ${trueValue} to i8*`);
    }
    this.emit(`br label %${mergeLabel}`);

    this.emit(`${falseConvLabel}:`);
    let falseVal = falseValue;
    if (resultType === "double" && falseType === "i32") {
      falseVal = this.nextTemp();
      this.emit(`${falseVal} = sitofp i32 ${falseValue} to double`);
    } else if (resultType === "double" && falseType === "i64") {
      falseVal = this.nextTemp();
      this.emit(`${falseVal} = sitofp i64 ${falseValue} to double`);
    } else if (resultType === "i8*" && falseType === "double") {
      falseVal = this.nextTemp();
      this.emit(`${falseVal} = call i8* @__double_to_string(double ${falseValue})`);
    } else if (resultType === "i8*" && falseType === "i32") {
      const asDouble = this.nextTemp();
      this.emit(`${asDouble} = sitofp i32 ${falseValue} to double`);
      falseVal = this.nextTemp();
      this.emit(`${falseVal} = call i8* @__double_to_string(double ${asDouble})`);
    } else if (resultType === "i8*" && falseType === "i64") {
      const asDouble = this.nextTemp();
      this.emit(`${asDouble} = sitofp i64 ${falseValue} to double`);
      falseVal = this.nextTemp();
      this.emit(`${falseVal} = call i8* @__double_to_string(double ${asDouble})`);
    } else if (
      resultType === "i8*" &&
      falseType &&
      falseType !== "i8*" &&
      falseType.indexOf("*") !== -1
    ) {
      falseVal = this.nextTemp();
      this.emit(`${falseVal} = bitcast ${falseType} ${falseValue} to i8*`);
    }
    this.emit(`br label %${mergeLabel}`);

    this.emit(`${mergeLabel}:`);
    const result = this.nextTemp();
    this.emit(
      `${result} = phi ${resultType} [ ${trueVal}, %${trueConvLabel} ], [ ${falseVal}, %${falseConvLabel} ]`,
    );
    this.ctx.setVariableType(result, resultType);

    return result;
  }
}
