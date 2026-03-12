import { Expression } from "../../../ast/types.js";
import { IGeneratorContext, IStringGenerator } from "../../infrastructure/generator-context.js";

import {
  createStringConstant,
  convertNumberToString,
  convertNumberToFixed,
} from "./string/constants.js";
import { generateStringConcat, generateStringConcatDirect } from "./string/concatenation.js";
import {
  generateSubstr,
  generateSlice,
  generateRepeat,
  generatePadStart,
  generatePadEnd,
  generateTrim,
  generateTrimStart,
  generateTrimEnd,
  generateReplace,
  generateReplaceAll,
  generateToUpperCase,
  generateToLowerCase,
} from "./string/manipulation.js";
import {
  generateStartsWith,
  generateCharAt,
  generateStringAt,
  generateCharCodeAt,
  generateIndexOf,
  generateLastIndexOf,
  generateIncludes,
  generateEndsWith,
} from "./string/search.js";
import { generateSplit } from "./string/split.js";

// ============================================
// STRING GENERATOR - String operations
// ============================================

export class StringGenerator implements IStringGenerator {
  constructor(private ctx: IGeneratorContext) {}

  // ============================================
  // String Constants & Conversions
  // ============================================

  doCreateStringConstant(value: string): string {
    return createStringConstant(this.ctx, value);
  }

  doConvertNumberToString(numValue: string): string {
    return convertNumberToString(this.ctx, numValue);
  }

  doConvertNumberToFixed(numValue: string, precisionValue: string): string {
    return convertNumberToFixed(this.ctx, numValue, precisionValue);
  }

  // ============================================
  // String Concatenation
  // ============================================

  doGenerateStringConcat(left: Expression, right: Expression, params: string[]): string {
    return generateStringConcat(this.ctx, left, right, params);
  }

  doGenerateStringConcatDirect(leftStr: string, rightStr: string): string {
    return generateStringConcatDirect(this.ctx, leftStr, rightStr);
  }

  // ============================================
  // String Manipulation
  // ============================================

  doGenerateSubstr(strPtr: string, startIndex: string, length: string | null): string {
    return generateSubstr(this.ctx, strPtr, startIndex, length);
  }

  doGenerateSlice(strPtr: string, startIndex: string, endIndex: string | null): string {
    return generateSlice(this.ctx, strPtr, startIndex, endIndex);
  }

  doGenerateRepeat(strPtr: string, count: string): string {
    return generateRepeat(this.ctx, strPtr, count);
  }

  doGeneratePadStart(strPtr: string, targetLength: string, padString: string): string {
    return generatePadStart(this.ctx, strPtr, targetLength, padString);
  }

  doGeneratePadEnd(strPtr: string, targetLength: string, padString: string): string {
    return generatePadEnd(this.ctx, strPtr, targetLength, padString);
  }

  doGenerateTrim(strPtr: string): string {
    return generateTrim(this.ctx, strPtr);
  }

  doGenerateTrimStart(strPtr: string): string {
    return generateTrimStart(this.ctx, strPtr);
  }

  doGenerateTrimEnd(strPtr: string): string {
    return generateTrimEnd(this.ctx, strPtr);
  }

  doGenerateToUpperCase(strPtr: string): string {
    return generateToUpperCase(this.ctx, strPtr);
  }

  doGenerateToLowerCase(strPtr: string): string {
    return generateToLowerCase(this.ctx, strPtr);
  }

  // ============================================
  // String Search & Query
  // ============================================

  doGenerateStartsWith(strPtr: string, prefix: string): string {
    return generateStartsWith(this.ctx, strPtr, prefix);
  }

  doGenerateCharAt(strPtr: string, index: string): string {
    return generateCharAt(this.ctx, strPtr, index);
  }

  doGenerateStringAt(strPtr: string, index: string): string {
    return generateStringAt(this.ctx, strPtr, index);
  }

  doGenerateCharCodeAt(strPtr: string, index: string): string {
    return generateCharCodeAt(this.ctx, strPtr, index);
  }

  doGenerateIndexOf(strPtr: string, substring: string): string {
    return generateIndexOf(this.ctx, strPtr, substring);
  }

  doGenerateLastIndexOf(strPtr: string, substring: string): string {
    return generateLastIndexOf(this.ctx, strPtr, substring);
  }

  doGenerateIncludes(strPtr: string, substring: string): string {
    return generateIncludes(this.ctx, strPtr, substring);
  }

  doGenerateEndsWith(strPtr: string, suffix: string): string {
    return generateEndsWith(this.ctx, strPtr, suffix);
  }

  // ============================================
  // String Split
  // ============================================

  doGenerateSplit(strPtr: string, delimiter: string): string {
    return generateSplit(this.ctx, strPtr, delimiter);
  }

  // ============================================
  // String Replace
  // ============================================

  doGenerateReplace(strPtr: string, search: string, replace: string): string {
    return generateReplace(this.ctx, strPtr, search, replace);
  }

  doGenerateReplaceAll(strPtr: string, search: string, replace: string): string {
    return generateReplaceAll(this.ctx, strPtr, search, replace);
  }

  doGenerateGlobalString(value: string): string {
    return createStringConstant(this.ctx, value);
  }
}
