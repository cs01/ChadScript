import { Expression } from '../../../../ast/types.js';
import { IGeneratorContext } from '../../../infrastructure/generator-context.js';
import { convertNumberToString } from './constants.js';

// ============================================
// STRING CONCATENATION - String concatenation operations
// ============================================

export function generateStringConcat(
  ctx: IGeneratorContext,
  left: Expression,
  right: Expression,
  params: string[]
): string {
  const leftValue = ctx.generateExpression(left, params);
  const rightValue = ctx.generateExpression(right, params);

  const leftIsString = ctx.isStringExpression(left) || ctx.getVariableType(leftValue) === 'i8*';
  const rightIsString = ctx.isStringExpression(right) || ctx.getVariableType(rightValue) === 'i8*';

  const leftStr = leftIsString ? leftValue : convertNumberToString(ctx, leftValue);
  const rightStr = rightIsString ? rightValue : convertNumberToString(ctx, rightValue);

  return generateStringConcatDirect(ctx, leftStr, rightStr);
}

export function generateStringConcatDirect(ctx: IGeneratorContext, leftStr: string, rightStr: string): string {
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
