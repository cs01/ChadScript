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

  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private nextString() { return this.ctx.nextString(); }

  private createGeneratorShim(): BaseGenerator {
    return {
      nextTemp: () => this.nextTemp(),
      nextLabel: (prefix: string) => this.nextLabel(prefix),
      emit: (instruction: string) => this.emit(instruction),
      nextString: () => this.nextString(),
      globalStrings: this.ctx.globalStrings,
      variableTypes: this.ctx.variableTypes,
      getVariableType: (name: string) => this.ctx.getVariableType(name),
      setVariableType: (name: string, type: string) => this.ctx.setVariableType(name, type),
    } as unknown as BaseGenerator;
  }

  // ============================================
  // String Constants & Conversions
  // ============================================

  createStringConstant(value: string): string {
    const genShim = this.createGeneratorShim();
    return createStringConstantImpl(genShim, value);
  }

  convertNumberToString(numValue: string): string {
    const genShim = this.createGeneratorShim();
    return convertNumberToStringImpl(genShim, numValue);
  }

  // ============================================
  // String Concatenation
  // ============================================

  generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    const genShim = this.createGeneratorShim();
    const ctx = this.ctx;
    return generateStringConcatImpl(
      genShim,
      left,
      right,
      params,
      (expr: Expression, p: string[]) => ctx.generateExpression(expr, p),
      (expr: Expression) => ctx.isStringExpression(expr)
    );
  }

  generateStringConcatDirect(leftStr: string, rightStr: string): string {
    const genShim = this.createGeneratorShim();
    return generateStringConcatDirectImpl(genShim, leftStr, rightStr);
  }

  // ============================================
  // String Manipulation
  // ============================================

  generateSubstr(strPtr: string, startIndex: string, length: string | null): string {
    const genShim = this.createGeneratorShim();
    return generateSubstrImpl(genShim, strPtr, startIndex, length);
  }

  generateSlice(strPtr: string, startIndex: string, endIndex: string | null): string {
    const genShim = this.createGeneratorShim();
    return generateSliceImpl(genShim, strPtr, startIndex, endIndex);
  }

  generateRepeat(strPtr: string, count: string): string {
    const genShim = this.createGeneratorShim();
    return generateRepeatImpl(genShim, strPtr, count);
  }

  generatePadStart(strPtr: string, targetLength: string, padString: string): string {
    const genShim = this.createGeneratorShim();
    return generatePadStartImpl(genShim, strPtr, targetLength, padString);
  }

  generateTrim(strPtr: string): string {
    const genShim = this.createGeneratorShim();
    return generateTrimImpl(genShim, strPtr);
  }

  // ============================================
  // String Search & Query
  // ============================================

  generateStartsWith(strPtr: string, prefix: string): string {
    const genShim = this.createGeneratorShim();
    return generateStartsWithImpl(genShim, strPtr, prefix);
  }

  generateCharAt(strPtr: string, index: string): string {
    const genShim = this.createGeneratorShim();
    return generateCharAtImpl(genShim, strPtr, index);
  }

  generateIndexOf(strPtr: string, substring: string): string {
    const genShim = this.createGeneratorShim();
    return generateIndexOfImpl(genShim, strPtr, substring);
  }

  generateIncludes(strPtr: string, substring: string): string {
    const genShim = this.createGeneratorShim();
    return generateIncludesImpl(genShim, strPtr, substring);
  }

  generateEndsWith(strPtr: string, suffix: string): string {
    const genShim = this.createGeneratorShim();
    return generateEndsWithImpl(genShim, strPtr, suffix);
  }

  // ============================================
  // String Split
  // ============================================

  generateSplit(strPtr: string, delimiter: string): string {
    const genShim = this.createGeneratorShim();
    return generateSplitImpl(genShim, strPtr, delimiter);
  }

  // ============================================
  // String Replace
  // ============================================

  generateReplace(strPtr: string, search: string, replace: string): string {
    const genShim = this.createGeneratorShim();
    return generateReplaceImpl(genShim, strPtr, search, replace);
  }

  generateReplaceAll(strPtr: string, search: string, replace: string): string {
    const genShim = this.createGeneratorShim();
    return generateReplaceAllImpl(genShim, strPtr, search, replace);
  }

  generateGlobalString(value: string): string {
    const genShim = this.createGeneratorShim();
    return createStringConstantImpl(genShim, value);
  }
}
