import { Expression } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';
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
  generateReplace as generateReplaceImpl,
  generateReplaceAll as generateReplaceAllImpl,
} from './string/manipulation.js';
import {
  generateStartsWith as generateStartsWithImpl,
  generateCharAt as generateCharAtImpl,
  generateIndexOf as generateIndexOfImpl,
  generateIncludes as generateIncludesImpl,
  generateEndsWith as generateEndsWithImpl,
} from './string/search.js';
import { generateSplit as generateSplitImpl } from './string/split.js';

// ============================================
// STRING GENERATOR - String operations
// ============================================

export class StringGenerator {
  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private nextString() { return this.ctx.nextString(); }

  // Create a shim object that looks like BaseGenerator for extracted functions
  private createGeneratorShim(): BaseGenerator {
    return {
      nextTemp: () => this.nextTemp(),
      nextLabel: (prefix: string) => this.nextLabel(prefix),
      emit: (instruction: string) => this.emit(instruction),
      nextString: () => this.nextString(),
      globalStrings: this.ctx.globalStrings,
      variableTypes: this.ctx.variableTypes,
      getVariableType: (name: string) => this.ctx.getVariableType(name),
    } as unknown as BaseGenerator;
  }

  // ============================================
  // String Constants & Conversions
  // ============================================

  createStringConstant(value: string): string {
    const genShim = this.createGeneratorShim();
    return createStringConstantImpl.call(genShim, value);
  }

  convertNumberToString(numValue: string): string {
    const genShim = this.createGeneratorShim();
    return convertNumberToStringImpl.call(genShim, numValue);
  }

  // ============================================
  // String Concatenation
  // ============================================

  generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    const genShim = this.createGeneratorShim();
    return generateStringConcatImpl.call(
      genShim,
      left,
      right,
      params,
      this.ctx.generateExpression.bind(this.ctx),
      this.ctx.isStringExpression.bind(this.ctx)
    );
  }

  generateStringConcatDirect(leftStr: string, rightStr: string): string {
    const genShim = this.createGeneratorShim();
    return generateStringConcatDirectImpl.call(genShim, leftStr, rightStr);
  }

  // ============================================
  // String Manipulation
  // ============================================

  generateSubstr(strPtr: string, startIndex: string, length: string | null): string {
    const genShim = this.createGeneratorShim();
    return generateSubstrImpl.call(genShim, strPtr, startIndex, length);
  }

  generateSlice(strPtr: string, startIndex: string, endIndex: string | null): string {
    const genShim = this.createGeneratorShim();
    return generateSliceImpl.call(genShim, strPtr, startIndex, endIndex);
  }

  generateRepeat(strPtr: string, count: string): string {
    const genShim = this.createGeneratorShim();
    return generateRepeatImpl.call(genShim, strPtr, count);
  }

  generatePadStart(strPtr: string, targetLength: string, padString: string): string {
    const genShim = this.createGeneratorShim();
    return generatePadStartImpl.call(genShim, strPtr, targetLength, padString);
  }

  generateTrim(strPtr: string): string {
    const genShim = this.createGeneratorShim();
    return generateTrimImpl.call(genShim, strPtr);
  }

  // ============================================
  // String Search & Query
  // ============================================

  generateStartsWith(strPtr: string, prefix: string): string {
    const genShim = this.createGeneratorShim();
    return generateStartsWithImpl.call(genShim, strPtr, prefix);
  }

  generateCharAt(strPtr: string, index: string): string {
    const genShim = this.createGeneratorShim();
    return generateCharAtImpl.call(genShim, strPtr, index);
  }

  generateIndexOf(strPtr: string, substring: string): string {
    const genShim = this.createGeneratorShim();
    return generateIndexOfImpl.call(genShim, strPtr, substring);
  }

  generateIncludes(strPtr: string, substring: string): string {
    const genShim = this.createGeneratorShim();
    return generateIncludesImpl.call(genShim, strPtr, substring);
  }

  generateEndsWith(strPtr: string, suffix: string): string {
    const genShim = this.createGeneratorShim();
    return generateEndsWithImpl.call(genShim, strPtr, suffix);
  }

  // ============================================
  // String Split
  // ============================================

  generateSplit(strPtr: string, delimiter: string): string {
    const genShim = this.createGeneratorShim();
    return generateSplitImpl.call(genShim, strPtr, delimiter);
  }

  // ============================================
  // String Replace
  // ============================================

  generateReplace(strPtr: string, search: string, replace: string): string {
    const genShim = this.createGeneratorShim();
    return generateReplaceImpl.call(genShim, strPtr, search, replace);
  }

  generateReplaceAll(strPtr: string, search: string, replace: string): string {
    const genShim = this.createGeneratorShim();
    return generateReplaceAllImpl.call(genShim, strPtr, search, replace);
  }

  generateGlobalString(value: string): string {
    const genShim = this.createGeneratorShim();
    return createStringConstantImpl.call(genShim, value);
  }
}
