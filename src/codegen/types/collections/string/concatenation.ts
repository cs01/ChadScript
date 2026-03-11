import { Expression, BinaryNode, UnaryNode } from "../../../../ast/types.js";
import { IGeneratorContext } from "../../../infrastructure/generator-context.js";
import { convertNumberToString, createStringConstant } from "./constants.js";

function isConcatComparisonOp(op: string): boolean {
  if (op === "===" || op === "!==" || op === "==" || op === "!=") return true;
  if (op === "<" || op === ">" || op === "<=" || op === ">=") return true;
  return false;
}

function isBooleanExpr(expr: Expression, valueType: string | null | undefined): boolean {
  if (expr.type === "boolean") return true;
  if (valueType === "i1") return true;
  if (expr.type === "binary" && isConcatComparisonOp((expr as BinaryNode).op)) return true;
  if (expr.type === "unary" && (expr as UnaryNode).op === "!") return true;
  return false;
}

function convertBooleanToString(ctx: IGeneratorContext, boolValue: string): string {
  const trueStr = createStringConstant(ctx, "true");
  const falseStr = createStringConstant(ctx, "false");
  const varType = ctx.getVariableType(boolValue);
  const cmp = ctx.nextTemp();
  if (varType === "i1") {
    ctx.emit(`${cmp} = select i1 ${boolValue}, i8* ${trueStr}, i8* ${falseStr}`);
    ctx.setVariableType(cmp, "i8*");
    return cmp;
  } else if (varType === "i64") {
    ctx.emit(`${cmp} = icmp ne i64 ${boolValue}, 0`);
  } else {
    ctx.emit(`${cmp} = fcmp one double ${boolValue}, 0.0`);
  }
  const selected = ctx.nextTemp();
  ctx.emit(`${selected} = select i1 ${cmp}, i8* ${trueStr}, i8* ${falseStr}`);
  ctx.setVariableType(selected, "i8*");
  return selected;
}

function nullSafeStr(ctx: IGeneratorContext, value: string, expr: Expression): string {
  if (expr.type === "null") {
    return createStringConstant(ctx, "null");
  }
  if (expr.type === "undefined") {
    return createStringConstant(ctx, "undefined");
  }
  const varType = ctx.getVariableType(value);
  if (varType === "i8*" || value.startsWith("@.str")) {
    const nullStr = createStringConstant(ctx, "null");
    const isNull = ctx.nextTemp();
    ctx.emit(`${isNull} = icmp eq i8* ${value}, null`);
    const safe = ctx.nextTemp();
    ctx.emit(`${safe} = select i1 ${isNull}, i8* ${nullStr}, i8* ${value}`);
    ctx.setVariableType(safe, "i8*");
    return safe;
  }
  return value;
}

function toStringValue(ctx: IGeneratorContext, expr: Expression, value: string): string {
  const varType = ctx.getVariableType(value);
  if (ctx.isStringExpression(expr) || varType === "i8*") return nullSafeStr(ctx, value, expr);
  if (isBooleanExpr(expr, varType)) return convertBooleanToString(ctx, value);
  return convertNumberToString(ctx, value);
}

// ============================================
// STRING CONCATENATION - String concatenation operations
// ============================================

export function generateStringConcat(
  ctx: IGeneratorContext,
  left: Expression,
  right: Expression,
  params: string[],
): string {
  const leftValue = ctx.generateExpression(left, params);
  const rightValue = ctx.generateExpression(right, params);

  const leftStr = toStringValue(ctx, left, leftValue);
  const rightStr = toStringValue(ctx, right, rightValue);

  return generateStringConcatDirect(ctx, leftStr, rightStr);
}

export function generateStringConcatDirect(
  ctx: IGeneratorContext,
  leftStr: string,
  rightStr: string,
): string {
  const leftLen = ctx.nextTemp();
  ctx.emit(`${leftLen} = call i64 @strlen(i8* ${leftStr})`);
  const rightLen = ctx.nextTemp();
  ctx.emit(`${rightLen} = call i64 @strlen(i8* ${rightStr})`);

  const totalLen = ctx.nextTemp();
  ctx.emit(`${totalLen} = add i64 ${leftLen}, ${rightLen}`);
  const totalLenPlus1 = ctx.nextTemp();
  ctx.emit(`${totalLenPlus1} = add i64 ${totalLen}, 1`);

  const resultPtr = ctx.nextTemp();
  ctx.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${totalLenPlus1})`);
  ctx.setVariableType(resultPtr, "i8*");

  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${leftStr}, i64 ${leftLen}, i1 false)`,
  );

  const dest = ctx.nextTemp();
  ctx.emit(`${dest} = getelementptr i8, i8* ${resultPtr}, i64 ${leftLen}`);

  const rightLenPlus1 = ctx.nextTemp();
  ctx.emit(`${rightLenPlus1} = add i64 ${rightLen}, 1`);
  ctx.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dest}, i8* ${rightStr}, i64 ${rightLenPlus1}, i1 false)`,
  );

  return resultPtr;
}
