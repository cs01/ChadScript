import { Expression } from '../../../ast/types.js';
import { BaseGenerator } from '../../infrastructure/base-generator.js';
import {
  createStringConstant as createStringConstantImpl,
  convertNumberToString as convertNumberToStringImpl,
} from './string/constants.js';
import {
  generateStringConcat as generateStringConcatImpl,
  generateStringConcatDirect as generateStringConcatDirectImpl,
} from './string/concatenation.js';
import {
  generateSubstr as generateSubstrImpl,
  generateSlice as generateSliceImpl,
  generateRepeat as generateRepeatImpl,
  generatePadStart as generatePadStartImpl,
  generateTrim as generateTrimImpl,
} from './string/manipulation.js';
import {
  generateStartsWith as generateStartsWithImpl,
  generateCharAt as generateCharAtImpl,
  generateIndexOf as generateIndexOfImpl,
  generateIncludes as generateIncludesImpl,
} from './string/search.js';
import { generateSplit as generateSplitImpl } from './string/split.js';

// ============================================
// STRING GENERATOR - String operations
// ============================================

export class StringGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;
  // Type check delegate (set by LLVMGenerator)
  isStringExpression!: (expr: Expression) => boolean;

  constructor() {
    super();
  }

  // ============================================
  // String Constants & Conversions
  // ============================================

  createStringConstant(value: string): string {
    return createStringConstantImpl.call(this, value);
  }

  convertNumberToString(numValue: string): string {
    return convertNumberToStringImpl.call(this, numValue);
  }

  // ============================================
  // String Concatenation
  // ============================================

  generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    return generateStringConcatImpl.call(
      this,
      left,
      right,
      params,
      this.generateExpression,
      this.isStringExpression
    );
  }

  generateStringConcatDirect(leftStr: string, rightStr: string): string {
    return generateStringConcatDirectImpl.call(this, leftStr, rightStr);
  }

  // ============================================
  // String Manipulation
  // ============================================

  generateSubstr(strPtr: string, startIndex: string, length: string | null): string {
    return generateSubstrImpl.call(this, strPtr, startIndex, length);
  }

  generateSlice(strPtr: string, startIndex: string, endIndex: string | null): string {
    return generateSliceImpl.call(this, strPtr, startIndex, endIndex);
  }

  generateRepeat(strPtr: string, count: string): string {
    return generateRepeatImpl.call(this, strPtr, count);
  }

  generatePadStart(strPtr: string, targetLength: string, padString: string): string {
    return generatePadStartImpl.call(this, strPtr, targetLength, padString);
  }

  generateTrim(strPtr: string): string {
    return generateTrimImpl.call(this, strPtr);
  }

  // ============================================
  // String Search & Query
  // ============================================

  generateStartsWith(strPtr: string, prefix: string): string {
    return generateStartsWithImpl.call(this, strPtr, prefix);
  }

  generateCharAt(strPtr: string, index: string): string {
    return generateCharAtImpl.call(this, strPtr, index);
  }

  generateIndexOf(strPtr: string, substring: string): string {
    return generateIndexOfImpl.call(this, strPtr, substring);
  }

  generateIncludes(strPtr: string, substring: string): string {
    return generateIncludesImpl.call(this, strPtr, substring);
  }

  // ============================================
  // String Split
  // ============================================

  generateSplit(strPtr: string, delimiter: string): string {
    return generateSplitImpl.call(this, strPtr, delimiter);
  }
}
