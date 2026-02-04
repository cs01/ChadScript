import { Expression } from '../../../ast/types.js';
import { IGeneratorContext, IStringGenerator } from '../../infrastructure/generator-context.js';

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
  generateReplace as generateReplaceImpl,
  generateReplaceAll as generateReplaceAllImpl,
  generateToUpperCase as generateToUpperCaseImpl,
  generateToLowerCase as generateToLowerCaseImpl,
} from './string/manipulation.js';
import {
  generateStartsWith as generateStartsWithImpl,
  generateCharAt as generateCharAtImpl,
  generateCharCodeAt as generateCharCodeAtImpl,
  generateIndexOf as generateIndexOfImpl,
  generateIncludes as generateIncludesImpl,
  generateEndsWith as generateEndsWithImpl,
} from './string/search.js';
import { generateSplit as generateSplitImpl } from './string/split.js';

// ============================================
// STRING GENERATOR - String operations
// ============================================

export class StringGenerator implements IStringGenerator {
  constructor(private ctx: IGeneratorContext) {}

  // ============================================
  // String Constants & Conversions
  // ============================================

  createStringConstant(value: string): string {
    return createStringConstantImpl(this.ctx, value);
  }

  convertNumberToString(numValue: string): string {
    return convertNumberToStringImpl(this.ctx, numValue);
  }

  // ============================================
  // String Concatenation
  // ============================================

  generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    return generateStringConcatImpl(this.ctx, left, right, params);
  }

  generateStringConcatDirect(leftStr: string, rightStr: string): string {
    return generateStringConcatDirectImpl(this.ctx, leftStr, rightStr);
  }

  // ============================================
  // String Manipulation
  // ============================================

  generateSubstr(strPtr: string, startIndex: string, length: string | null): string {
    return generateSubstrImpl(this.ctx, strPtr, startIndex, length);
  }

  generateSlice(strPtr: string, startIndex: string, endIndex: string | null): string {
    return generateSliceImpl(this.ctx, strPtr, startIndex, endIndex);
  }

  generateRepeat(strPtr: string, count: string): string {
    return generateRepeatImpl(this.ctx, strPtr, count);
  }

  generatePadStart(strPtr: string, targetLength: string, padString: string): string {
    return generatePadStartImpl(this.ctx, strPtr, targetLength, padString);
  }

  generateTrim(strPtr: string): string {
    return generateTrimImpl(this.ctx, strPtr);
  }

  generateToUpperCase(strPtr: string): string {
    return generateToUpperCaseImpl(this.ctx, strPtr);
  }

  generateToLowerCase(strPtr: string): string {
    return generateToLowerCaseImpl(this.ctx, strPtr);
  }

  // ============================================
  // String Search & Query
  // ============================================

  generateStartsWith(strPtr: string, prefix: string): string {
    return generateStartsWithImpl(this.ctx, strPtr, prefix);
  }

  generateCharAt(strPtr: string, index: string): string {
    return generateCharAtImpl(this.ctx, strPtr, index);
  }

  generateCharCodeAt(strPtr: string, index: string): string {
    return generateCharCodeAtImpl(this.ctx, strPtr, index);
  }

  generateIndexOf(strPtr: string, substring: string): string {
    return generateIndexOfImpl(this.ctx, strPtr, substring);
  }

  generateIncludes(strPtr: string, substring: string): string {
    return generateIncludesImpl(this.ctx, strPtr, substring);
  }

  generateEndsWith(strPtr: string, suffix: string): string {
    return generateEndsWithImpl(this.ctx, strPtr, suffix);
  }

  // ============================================
  // String Split
  // ============================================

  generateSplit(strPtr: string, delimiter: string): string {
    return generateSplitImpl(this.ctx, strPtr, delimiter);
  }

  // ============================================
  // String Replace
  // ============================================

  generateReplace(strPtr: string, search: string, replace: string): string {
    return generateReplaceImpl(this.ctx, strPtr, search, replace);
  }

  generateReplaceAll(strPtr: string, search: string, replace: string): string {
    return generateReplaceAllImpl(this.ctx, strPtr, search, replace);
  }

  generateGlobalString(value: string): string {
    return createStringConstantImpl(this.ctx, value);
  }
}
