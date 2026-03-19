// String split IR generator: splits a string by delimiter into a StringArray.
// Uses structured IR builders where possible; raw emit() for phi, select, add, sub, mul,
// zext, sext, alloca, inbounds GEP, memcpy intrinsics, and or.

import { IGeneratorContext } from "../../../infrastructure/generator-context.js";

// ============================================
// STRING SPLIT - Complex string splitting into arrays
// ============================================

export function generateSplit(ctx: IGeneratorContext, strPtr: string, delimiter: string): string {
  const strLen = ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
  const delimLen = ctx.emitCall("i64", "@strlen", `i8* ${delimiter}`);
  const result = ctx.emitCall(
    "%StringArray*",
    "@cs_str_split",
    `i8* ${strPtr}, i64 ${strLen}, i8* ${delimiter}, i64 ${delimLen}`,
  );
  ctx.setVariableType(result, "%StringArray*");
  return result;
}
