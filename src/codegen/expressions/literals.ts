import { Expression, ArrayNode, ObjectNode, MapNode, SetNode, StringNode } from '../../ast/types.js';

import { parseMapTypeString, parseSetTypeString } from '../infrastructure/type-system.js';
import type { IStringGenerator, IStringMapGenerator, IMapGenerator, ISetGenerator, IStringSetGenerator, IArrayGenerator } from '../infrastructure/generator-context.js';

export interface LiteralGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  syncStateToGenerators(): void;
  generateExpression(expr: Expression, params: string[]): string;
  setVariableType(name: string, type: string): void;
  setUsesPromises(value: boolean): void;
  getThisPointer(): string | null;
  getCurrentDeclaredMapType(): string | undefined;
  getCurrentDeclaredSetType(): string | undefined;
  classGenGenerateNewExpression(className: string, args: Expression[], params: string[]): string;
  readonly stringGen: IStringGenerator;
  readonly stringMapGen: IStringMapGenerator;
  readonly arrayGen: IArrayGenerator;
  readonly mapGen: IMapGenerator;
  readonly setGen: ISetGenerator;
  readonly stringSetGen: IStringSetGenerator;
  readonly regexGen: {
    generateRegexCompile(pattern: string, flags: string): string;
    generateRegexCompileRuntime(patternPtr: string, cflags: number): string;
  };
  readonly objectGen: {
    generateObjectLiteral(expr: Expression, params: string[]): string;
  };
}

/**
 * LiteralExpressionGenerator
 *
 * Generates LLVM IR for literal expressions:
 * - Numbers (integer and floating-point)
 * - Booleans (true/false)
 * - Strings (delegates to StringGenerator)
 * - Regex (delegates to RegexGenerator)
 * - Arrays (delegates to ArrayGenerator)
 * - Objects (delegates to ObjectGenerator)
 * - Maps (delegates to MapGenerator)
 * - Sets (delegates to SetGenerator)
 * - New expressions (delegates to ClassGenerator)
 * - This keyword
 */
export class LiteralExpressionGenerator {
  constructor(private ctx: LiteralGeneratorContext) {}

  /**
   * Generate number literal
   * Converts integers to double via sitofp for consistency with JavaScript semantics
   */
  generateNumber(value: number): string {
    const isInteger = (value % 1 === 0);

    if (isInteger && value >= -2147483648 && value <= 2147483647) {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = sitofp i32 ${value} to double`);
      this.ctx.setVariableType(temp, 'double');
      return temp;
    } else {
      const s = String(value);
      if (!s.includes('.') && !s.includes('e') && !s.includes('E') && !s.includes('inf') && !s.includes('NaN')) {
        return s + '.0';
      }
      return s;
    }
  }

  /**
   * Generate boolean literal (true/false)
   * Converts to double for compatibility with numeric system
   */
  generateBoolean(value: boolean): string {
    const boolValue = value ? 1 : 0;
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = sitofp i32 ${boolValue} to double`);
    this.ctx.setVariableType(temp, 'double');
    return temp;
  }

  /**
   * Generate string literal (delegates to StringGenerator)
   */
  generateString(value: string): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.stringGen.doCreateStringConstant(value);
  }

  /**
   * Generate regex literal (delegates to RegexGenerator)
   */
  generateRegex(pattern: string, flags: string): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.regexGen.generateRegexCompile(pattern, flags);
  }

  /**
   * Generate array literal (delegates to ArrayGenerator)
   * ArrayGenerator uses context pattern - no sync needed! 🎯
   */
  generateArray(expr: ArrayNode, params: string[]): string {
    return this.ctx.arrayGen.generateArrayLiteral(expr, params);
  }

  /**
   * Generate object literal (delegates to ObjectGenerator)
   */
  generateObject(expr: ObjectNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.objectGen.generateObjectLiteral(expr, params);
  }

  /**
   * Generate Map literal (delegates to MapGenerator or StringMapGenerator)
   */
  generateMap(expr: MapNode, params: string[]): string {
    this.ctx.syncStateToGenerators();

    if (expr.keyType === 'string') {
      return this.ctx.stringMapGen.generateEmptyStringMap();
    }

    const declaredType = this.ctx.getCurrentDeclaredMapType();
    if (declaredType) {
      const mapParsed = parseMapTypeString(declaredType);
      if (mapParsed && mapParsed.keyType === 'string') {
        return this.ctx.stringMapGen.generateEmptyStringMap();
      }
    }

    return this.ctx.mapGen.generateMapLiteral(expr, params);
  }

  /**
   * Generate Set literal (delegates to SetGenerator or StringSetGenerator)
   */
  generateSet(expr: SetNode, params: string[]): string {
    this.ctx.syncStateToGenerators();

    if (expr.valueType === 'string') {
      return this.ctx.stringSetGen.generateEmptyStringSet();
    }

    const declaredType = this.ctx.getCurrentDeclaredSetType();
    if (declaredType) {
      const setParsed = parseSetTypeString(declaredType);
      if (setParsed && setParsed.valueType === 'string') {
        return this.ctx.stringSetGen.generateEmptyStringSet();
      }
    }

    return this.ctx.setGen.generateSetLiteral(expr, params);
  }

  /**
   * Generate new expression (delegates to ClassGenerator or built-in types)
   */
  generateNew(className: string, args: Expression[], params: string[], typeArgs?: string[]): string {
    if (className === 'Promise') {
      return this.generateNewPromise(args, params);
    }
    if (className === 'RegExp') {
      return this.generateNewRegExp(args, params);
    }
    if (className === 'Set') {
      if (typeArgs && typeArgs.length > 0 && typeArgs[0] === 'string') {
        return this.ctx.stringSetGen.generateEmptyStringSet();
      }
      return this.ctx.setGen.generateSetLiteral({ type: 'set', values: [] }, params);
    }
    this.ctx.syncStateToGenerators();
    return this.ctx.classGenGenerateNewExpression(className, args, params);
  }

  /**
   * Generate new Promise(executor) expression
   * The executor is a function (resolve, reject) => { ... }
   */
  generateNewPromise(_args: Expression[], _params: string[]): string {
    this.ctx.setUsesPromises(true);
    const promiseResult = this.ctx.nextTemp();
    this.ctx.emit(`${promiseResult} = call %Promise* @__Promise_new()`);
    this.ctx.setVariableType(promiseResult, '%Promise*');
    return promiseResult;
  }

  generateNewRegExp(args: Expression[], params: string[]): string {
    if (args.length < 1) {
      throw new Error('new RegExp() requires at least 1 argument');
    }

    const patternArg = args[0] as { type: string; value?: string };
    const flagsArg = args.length > 1 ? args[1] as { type: string; value?: string } : null;

    let flags = '';
    if (flagsArg && flagsArg.type === 'string' && flagsArg.value !== undefined) {
      flags = flagsArg.value;
    }

    if (patternArg.type === 'string' && patternArg.value !== undefined) {
      this.ctx.syncStateToGenerators();
      return this.ctx.regexGen.generateRegexCompile(patternArg.value, flags);
    }

    const REG_EXTENDED = 1;
    const REG_ICASE = 2;
    const REG_NEWLINE = process.platform === 'darwin' ? 8 : 4;
    let cflags = REG_EXTENDED;
    if (flags.indexOf('i') !== -1) cflags = cflags | REG_ICASE;
    if (flags.indexOf('m') !== -1) cflags = cflags | REG_NEWLINE;

    this.ctx.syncStateToGenerators();
    const patternPtr = this.ctx.generateExpression(args[0], params);
    return this.ctx.regexGen.generateRegexCompileRuntime(patternPtr, cflags);
  }

  /**
   * Generate 'this' keyword
   * Returns the current this pointer from class context
   */
  generateThis(): string {
    const thisPtr = this.ctx.getThisPointer();
    if (!thisPtr) {
      throw new Error('this keyword used outside of class method or constructor');
    }
    return thisPtr;
  }
}
