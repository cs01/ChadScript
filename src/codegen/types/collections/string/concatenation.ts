import { Expression } from '../../../../ast/types.js';
import { BaseGenerator } from '../../../infrastructure/base-generator.js';
import { convertNumberToString } from './constants.js';

// ============================================
// STRING CONCATENATION - String concatenation operations
// ============================================

export function generateStringConcat(
  ctx: BaseGenerator,
  left: Expression,
  right: Expression,
  params: string[],
  generateExpression: (expr: Expression, params: string[]) => string,
  isStringExpression: (expr: Expression) => boolean
): string {
  const leftValue = generateExpression(left, params);
  const rightValue = generateExpression(right, params);

  const leftIsString = isStringExpression(left) || ctx.getVariableType(leftValue) === 'i8*';
  const rightIsString = isStringExpression(right) || ctx.getVariableType(rightValue) === 'i8*';

  const leftStr = leftIsString ? leftValue : convertNumberToString(ctx, leftValue);
  const rightStr = rightIsString ? rightValue : convertNumberToString(ctx, rightValue);

  return generateStringConcatDirect(ctx, leftStr, rightStr);
}

export function generateStringConcatDirect(ctx: BaseGenerator, leftStr: string, rightStr: string): string {
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

  const copyResult1 = ctx.nextTemp();
  ctx.emit(`${copyResult1} = call i8* @strcpy(i8* ${resultPtr}, i8* ${leftStr})`);

  const concatResult = ctx.nextTemp();
  ctx.emit(`${concatResult} = call i8* @strcat(i8* ${resultPtr}, i8* ${rightStr})`);

  return resultPtr;
}
