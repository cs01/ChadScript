import { Expression } from '../../../../ast/types.js';
import { BaseGenerator } from '../../../infrastructure/base-generator.js';
import { convertNumberToString } from './constants.js';

// ============================================
// STRING CONCATENATION - String concatenation operations
// ============================================

export function generateStringConcat(
  this: BaseGenerator,
  left: Expression,
  right: Expression,
  params: string[],
  generateExpression: (expr: Expression, params: string[]) => string,
  isStringExpression: (expr: Expression) => boolean
): string {
  // Generate both operands
  const leftValue = generateExpression(left, params);
  const rightValue = generateExpression(right, params);

  // Check if either operand needs to be converted from number to string
  const leftIsString = isStringExpression(left) || this.getVariableType(leftValue) === 'i8*';
  const rightIsString = isStringExpression(right) || this.getVariableType(rightValue) === 'i8*';

  // Convert numbers to strings if needed
  const leftStr = leftIsString ? leftValue : convertNumberToString.call(this, leftValue);
  const rightStr = rightIsString ? rightValue : convertNumberToString.call(this, rightValue);

  return generateStringConcatDirect.call(this, leftStr, rightStr);
}

export function generateStringConcatDirect(this: BaseGenerator, leftStr: string, rightStr: string): string {
  // Get lengths of both strings
  const leftLen = this.nextTemp();
  this.emit(`${leftLen} = call i64 @strlen(i8* ${leftStr})`);
  const rightLen = this.nextTemp();
  this.emit(`${rightLen} = call i64 @strlen(i8* ${rightStr})`);

  // Calculate total length (left + right + 1 for null terminator)
  const totalLen = this.nextTemp();
  this.emit(`${totalLen} = add i64 ${leftLen}, ${rightLen}`);
  const totalLenPlus1 = this.nextTemp();
  this.emit(`${totalLenPlus1} = add i64 ${totalLen}, 1`);

  // Allocate memory for result
  const resultPtr = this.nextTemp();
  this.emit(`${resultPtr} = call i8* @GC_malloc_atomic(i64 ${totalLenPlus1})`);

  // Copy left string to result
  const copyResult1 = this.nextTemp();
  this.emit(`${copyResult1} = call i8* @strcpy(i8* ${resultPtr}, i8* ${leftStr})`);

  // Concatenate right string to result
  const concatResult = this.nextTemp();
  this.emit(`${concatResult} = call i8* @strcat(i8* ${resultPtr}, i8* ${rightStr})`);

  return resultPtr;
}
