import { Expression, ArrayNode, ObjectNode, MapNode, SetNode } from '../../ast/types.js';

interface StringGeneratorLike {
  createStringConstant(value: string): string;
}

interface RegexGeneratorLike {
  generateRegexCompile(pattern: string, flags: string): string;
}

interface ArrayGeneratorLike {
  generateArrayLiteral(expr: ArrayNode, params: string[]): string;
}

interface ObjectGeneratorLike {
  generateObjectLiteral(expr: ObjectNode, params: string[]): string;
}

interface MapGeneratorLike {
  generateMapLiteral(expr: MapNode, params: string[]): string;
}

interface SetGeneratorLike {
  generateSetLiteral(expr: SetNode, params: string[]): string;
}

interface StringMapGeneratorLike {
  generateEmptyStringMap(): string;
}

interface StringSetGeneratorLike {
  generateEmptyStringSet(): string;
}

interface ClassGeneratorLike {
  generateNewExpression(className: string, args: Expression[], params: string[]): string;
}

export interface LiteralGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  syncStateToGenerators(): void;
  generateExpression(expr: Expression, params: string[]): string;
  variableTypes: Map<string, string>;
  setVariableType(name: string, type: string): void;
  usesPromises: boolean;
  thisPointer: string | null;
  currentDeclaredMapType?: string;
  getCurrentDeclaredMapType(): string | undefined;
  currentDeclaredSetType?: string;
  getCurrentDeclaredSetType(): string | undefined;
  stringGen: StringGeneratorLike;
  regexGen: RegexGeneratorLike;
  arrayGen: ArrayGeneratorLike;
  objectGen: ObjectGeneratorLike;
  mapGen: MapGeneratorLike;
  setGen: SetGeneratorLike;
  stringMapGen: StringMapGeneratorLike;
  stringSetGen: StringSetGeneratorLike;
  classGen: ClassGeneratorLike;
  classGenGenerateNewExpression(className: string, args: Expression[], params: string[]): string;
  stringGenCreateStringConstant(value: string): string;
  stringMapGenGenerateEmptyStringMap(): string;
  arrayGenGenerateArrayLiteral(expr: ArrayNode, params: string[]): string;
  mapGenGenerateMapLiteral(expr: MapNode, params: string[]): string;
  setGenGenerateSetLiteral(expr: SetNode, params: string[]): string;
  stringSetGenGenerateEmptyStringSet(): string;
  regexGenGenerateRegexCompile(pattern: string, flags: string): string;
  objectGenGenerateObjectLiteral(expr: Expression, params: string[]): string;
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
    const isInteger = (Math.floor(value) === value);

    if (isInteger) {
      // Generate integer literals as registers that can be converted to i32 or double as needed
      const temp = this.ctx.nextTemp();
      const intValue = Math.floor(value);
      this.ctx.emit(`${temp} = sitofp i32 ${intValue} to double`);
      this.ctx.setVariableType(temp, 'double');
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
    this.ctx.setVariableType(temp, 'double');
    return temp;
  }

  /**
   * Generate string literal (delegates to StringGenerator)
   */
  generateString(value: string): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.stringGenCreateStringConstant(value);
  }

  /**
   * Generate regex literal (delegates to RegexGenerator)
   */
  generateRegex(pattern: string, flags: string): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.regexGenGenerateRegexCompile(pattern, flags);
  }

  /**
   * Generate array literal (delegates to ArrayGenerator)
   * ArrayGenerator uses context pattern - no sync needed! 🎯
   */
  generateArray(expr: ArrayNode, params: string[]): string {
    return this.ctx.arrayGenGenerateArrayLiteral(expr, params);
  }

  /**
   * Generate object literal (delegates to ObjectGenerator)
   */
  generateObject(expr: ObjectNode, params: string[]): string {
    this.ctx.syncStateToGenerators();
    return this.ctx.objectGenGenerateObjectLiteral(expr, params);
  }

  /**
   * Generate Map literal (delegates to MapGenerator or StringMapGenerator)
   */
  generateMap(expr: MapNode, params: string[]): string {
    this.ctx.syncStateToGenerators();

    const declaredType = this.ctx.getCurrentDeclaredMapType();
    if (declaredType) {
      const match = declaredType.match(/^Map<\s*(\w+)\s*,\s*(.+)\s*>$/);
      if (match && match[1] === 'string') {
        return this.ctx.stringMapGenGenerateEmptyStringMap();
      }
    }

    return this.ctx.mapGenGenerateMapLiteral(expr, params);
  }

  /**
   * Generate Set literal (delegates to SetGenerator or StringSetGenerator)
   */
  generateSet(expr: SetNode, params: string[]): string {
    this.ctx.syncStateToGenerators();

    if (expr.valueType === 'string') {
      return this.ctx.stringSetGenGenerateEmptyStringSet();
    }

    const declaredType = this.ctx.getCurrentDeclaredSetType();
    if (declaredType) {
      const match = declaredType.match(/^Set<\s*(\w+)\s*>$/);
      if (match && match[1] === 'string') {
        return this.ctx.stringSetGenGenerateEmptyStringSet();
      }
    }

    return this.ctx.setGenGenerateSetLiteral(expr, params);
  }

  /**
   * Generate new expression (delegates to ClassGenerator or built-in types)
   */
  generateNew(className: string, args: Expression[], params: string[], typeArgs?: string[]): string {
    if (className === 'Promise') {
      return this.generateNewPromise(args, params);
    }
    if (className === 'Set') {
      if (typeArgs && typeArgs.length > 0 && typeArgs[0] === 'string') {
        return this.ctx.stringSetGenGenerateEmptyStringSet();
      }
      return this.ctx.setGenGenerateSetLiteral({ type: 'set', values: [] }, params);
    }
    this.ctx.syncStateToGenerators();
    return this.ctx.classGenGenerateNewExpression(className, args, params);
  }

  /**
   * Generate new Promise(executor) expression
   * The executor is a function (resolve, reject) => { ... }
   */
  generateNewPromise(_args: Expression[], _params: string[]): string {
    this.ctx.usesPromises = true;
    const promiseResult = this.ctx.nextTemp();
    this.ctx.emit(`${promiseResult} = call %Promise* @__Promise_new()`);
    this.ctx.setVariableType(promiseResult, '%Promise*');
    return promiseResult;
  }

  /**
   * Generate 'this' keyword
   * Returns the current this pointer from class context
   */
  generateThis(): string {
    const thisPtr = this.ctx.thisPointer;
    if (!thisPtr) {
      throw new Error('this keyword used outside of class method or constructor');
    }
    return thisPtr;
  }
}
