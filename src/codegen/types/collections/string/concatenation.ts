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
  ctx.setVariableType(resultPtr, 'i8*');

  ctx.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${resultPtr}, i8* ${leftStr}, i64 ${leftLen}, i1 false)`);

  const dest = ctx.nextTemp();
  ctx.emit(`${dest} = getelementptr i8, i8* ${resultPtr}, i64 ${leftLen}`);

  const rightLenPlus1 = ctx.nextTemp();
  ctx.emit(`${rightLenPlus1} = add i64 ${rightLen}, 1`);
  ctx.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dest}, i8* ${rightStr}, i64 ${rightLenPlus1}, i1 false)`);

  return resultPtr;
}
