import { Expression } from '../../ast/types.js';

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
  constructor(private ctx: any) {}

  /**
   * Generate number literal
   * Converts integers to double via sitofp for consistency with JavaScript semantics
   */
  generateNumber(value: number): string {
    const isInteger = Number.isInteger(value);

    if (isInteger) {
      // Generate integer literals as registers that can be converted to i32 or double as needed
      const temp = this.ctx.nextTemp();
      const intValue = Math.floor(value);
      this.ctx.emit(`${temp} = sitofp i32 ${intValue} to double`);
      this.ctx.variableTypes.set(temp, 'double');
      return temp;
    } else {
      // Floating-point literals stay as constants
      return String(value);
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
    this.ctx.variableTypes.set(temp, 'double');
    return temp;
  }

  /**
   * Generate string literal (delegates to StringGenerator)
   */
  generateString(value: string): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.stringGen.createStringConstant(value);
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
   */
  generateArray(expr: any, params: string[]): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.arrayGen.generateArrayLiteral(expr, params);
  }

  /**
   * Generate object literal (delegates to ObjectGenerator)
   */
  generateObject(expr: any, params: string[]): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.objectGen.generateObjectLiteral(expr, params);
  }

  /**
   * Generate Map literal (delegates to MapGenerator)
   */
  generateMap(expr: any, params: string[]): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.mapGen.generateMapLiteral(expr, params, this.ctx.generateExpression.bind(this.ctx));
  }

  /**
   * Generate Set literal (delegates to SetGenerator)
   */
  generateSet(expr: any, params: string[]): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.setGen.generateSetLiteral(expr, params, this.ctx.generateExpression.bind(this.ctx));
  }

  /**
   * Generate new expression (delegates to ClassGenerator)
   */
  generateNew(className: string, args: any[], params: string[]): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.classGen.generateNewExpression(className, args, params);
  }

  /**
   * Generate 'this' keyword
   * Returns the current this pointer from class context
   */
  generateThis(): string {
    const thisPtr = this.ctx.thisPointer || this.ctx.classGen.thisPointer;
    if (!thisPtr) {
      throw new Error('this keyword used outside of class method or constructor');
    }
    return thisPtr;
  }
}
