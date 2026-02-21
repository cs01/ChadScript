import {
  Expression,
  ArrayNode,
  ObjectNode,
  MapNode,
  SetNode,
  StringNode,
} from "../../ast/types.js";

import { parseMapTypeString, parseSetTypeString } from "../infrastructure/type-system.js";
import type {
  IStringGenerator,
  IStringMapGenerator,
  IMapGenerator,
  ISetGenerator,
  IStringSetGenerator,
  IArrayGenerator,
} from "../infrastructure/generator-context.js";

export interface LiteralGeneratorContext {
  nextTemp(): string;
  emit(instruction: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  setVariableType(name: string, type: string): void;
  getVariableType(name: string): string | undefined;
  setUsesPromises(value: boolean): void;
  getThisPointer(): string | null;
  getCurrentDeclaredMapType(): string | undefined;
  getCurrentDeclaredSetType(): string | undefined;
  classGenGenerateNewExpression(className: string, args: Expression[], params: string[]): string;
  ensureDouble(value: string): string;
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
    const isInteger = value % 1 === 0;

    if (isInteger && value >= -9007199254740991 && value <= 9007199254740991) {
      const temp = this.ctx.nextTemp();
      const intStr = value.toFixed(0);
      this.ctx.emit(`${temp} = add i64 ${intStr}, 0`);
      this.ctx.setVariableType(temp, "i64");
      return temp;
    } else {
      const s = String(value);
      if (
        !s.includes(".") &&
        !s.includes("e") &&
        !s.includes("E") &&
        !s.includes("inf") &&
        !s.includes("NaN")
      ) {
        return s + ".0";
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
    this.ctx.emit(`${temp} = add i64 ${boolValue}, 0`);
    this.ctx.setVariableType(temp, "i64");
    return temp;
  }

  /**
   * Generate string literal (delegates to StringGenerator)
   */
  generateString(value: string): string {
    return this.ctx.stringGen.doCreateStringConstant(value);
  }

  /**
   * Generate regex literal (delegates to RegexGenerator)
   */
  generateRegex(pattern: string, flags: string): string {
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
    return this.ctx.objectGen.generateObjectLiteral(expr, params);
  }

  /**
   * Generate Map literal (delegates to MapGenerator or StringMapGenerator)
   */
  generateMap(expr: MapNode, params: string[]): string {
    if (expr.keyType === "string") {
      return this.ctx.stringMapGen.generateEmptyStringMap();
    }

    const declaredType = this.ctx.getCurrentDeclaredMapType();
    if (declaredType) {
      const mapParsed = parseMapTypeString(declaredType);
      if (mapParsed && mapParsed.keyType === "string") {
        return this.ctx.stringMapGen.generateEmptyStringMap();
      }
    }

    return this.ctx.mapGen.generateMapLiteral(expr, params);
  }

  /**
   * Generate Set literal (delegates to SetGenerator or StringSetGenerator)
   */
  generateSet(expr: SetNode, params: string[]): string {
    if (expr.valueType === "string") {
      return this.ctx.stringSetGen.generateEmptyStringSet();
    }

    const declaredType = this.ctx.getCurrentDeclaredSetType();
    if (declaredType) {
      const setParsed = parseSetTypeString(declaredType);
      if (setParsed && setParsed.valueType === "string") {
        return this.ctx.stringSetGen.generateEmptyStringSet();
      }
    }

    return this.ctx.setGen.generateSetLiteral(expr, params);
  }

  /**
   * Generate new expression (delegates to ClassGenerator or built-in types)
   */
  generateNew(
    className: string,
    args: Expression[],
    params: string[],
    typeArgs?: string[],
  ): string {
    if (className === "Promise") {
      return this.generateNewPromise(args, params);
    }
    if (className === "RegExp") {
      return this.generateNewRegExp(args, params);
    }
    if (className === "Set") {
      if (typeArgs && typeArgs.length > 0 && typeArgs[0] === "string") {
        return this.ctx.stringSetGen.generateEmptyStringSet();
      }
      return this.ctx.setGen.generateSetLiteral({ type: "set", values: [] }, params);
    }
    if (className === "Uint8Array") {
      return this.generateNewUint8Array(args, params);
    }
    if (className === "Date") {
      return this.generateNewDate(args, params);
    }
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
    this.ctx.setVariableType(promiseResult, "%Promise*");
    return promiseResult;
  }

  generateNewRegExp(args: Expression[], params: string[]): string {
    if (args.length < 1) {
      throw new Error("new RegExp() requires at least 1 argument");
    }

    const patternArg = args[0] as { type: string; value?: string };
    const flagsArg = args.length > 1 ? (args[1] as { type: string; value?: string }) : null;

    let flags = "";
    if (flagsArg && flagsArg.type === "string" && flagsArg.value !== undefined) {
      flags = flagsArg.value;
    }

    if (patternArg.type === "string" && patternArg.value !== undefined) {
      return this.ctx.regexGen.generateRegexCompile(patternArg.value, flags);
    }

    const REG_EXTENDED = 1;
    const REG_ICASE = 2;
    const REG_NEWLINE = process.platform === "darwin" ? 8 : 4;
    let cflags = REG_EXTENDED;
    if (flags.indexOf("i") !== -1) cflags = cflags | REG_ICASE;
    if (flags.indexOf("m") !== -1) cflags = cflags | REG_NEWLINE;

    const patternPtr = this.ctx.generateExpression(args[0], params);
    return this.ctx.regexGen.generateRegexCompileRuntime(patternPtr, cflags);
  }

  private generateNewUint8Array(args: Expression[], params: string[]): string {
    if (args.length < 1) {
      throw new Error("new Uint8Array() requires a size argument");
    }

    const sizeValue = this.ctx.generateExpression(args[0], params);
    const sizeDouble = this.ctx.ensureDouble(sizeValue);

    const sizeI32 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI32} = fptosi double ${sizeDouble} to i32`);

    const sizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI64} = sext i32 ${sizeI32} to i64`);

    const structSize = this.ctx.nextTemp();
    this.ctx.emit(`${structSize} = add i64 0, 12`);
    const structRaw = this.ctx.nextTemp();
    this.ctx.emit(`${structRaw} = call i8* @GC_malloc(i64 ${structSize})`);
    const structPtr = this.ctx.nextTemp();
    this.ctx.emit(`${structPtr} = bitcast i8* ${structRaw} to %Uint8Array*`);

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = call i8* @GC_malloc_atomic(i64 ${sizeI64})`);
    this.ctx.emit(
      `call void @llvm.memset.p0i8.i64(i8* ${dataPtr}, i8 0, i64 ${sizeI64}, i1 false)`,
    );

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${structPtr}, i32 0, i32 0`,
    );
    this.ctx.emit(`store i8* ${dataPtr}, i8** ${dataFieldPtr}`);

    const lenFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${lenFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${structPtr}, i32 0, i32 1`,
    );
    this.ctx.emit(`store i32 ${sizeI32}, i32* ${lenFieldPtr}`);

    const capFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${capFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${structPtr}, i32 0, i32 2`,
    );
    this.ctx.emit(`store i32 ${sizeI32}, i32* ${capFieldPtr}`);

    this.ctx.setVariableType(structPtr, "%Uint8Array*");
    return structPtr;
  }

  private generateNewDate(args: Expression[], params: string[]): string {
    const structRaw = this.ctx.nextTemp();
    this.ctx.emit(`${structRaw} = call i8* @GC_malloc(i64 8)`);
    const datePtr = this.ctx.nextTemp();
    this.ctx.emit(`${datePtr} = bitcast i8* ${structRaw} to %Date*`);

    let msValue: string;
    if (args.length === 0) {
      const tvAlloca = this.ctx.nextTemp();
      this.ctx.emit(`${tvAlloca} = alloca %struct.timeval`);
      const gettimResult = this.ctx.nextTemp();
      this.ctx.emit(
        `${gettimResult} = call i32 @gettimeofday(%struct.timeval* ${tvAlloca}, i8* null)`,
      );
      const secPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${secPtr} = getelementptr inbounds %struct.timeval, %struct.timeval* ${tvAlloca}, i32 0, i32 0`,
      );
      const secVal = this.ctx.nextTemp();
      this.ctx.emit(`${secVal} = load i64, i64* ${secPtr}`);
      const usecPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${usecPtr} = getelementptr inbounds %struct.timeval, %struct.timeval* ${tvAlloca}, i32 0, i32 1`,
      );
      const usecVal = this.ctx.nextTemp();
      this.ctx.emit(`${usecVal} = load i64, i64* ${usecPtr}`);
      const secDbl = this.ctx.nextTemp();
      this.ctx.emit(`${secDbl} = sitofp i64 ${secVal} to double`);
      const usecDbl = this.ctx.nextTemp();
      this.ctx.emit(`${usecDbl} = sitofp i64 ${usecVal} to double`);
      const secMs = this.ctx.nextTemp();
      this.ctx.emit(`${secMs} = fmul fast double ${secDbl}, 1.000000e+03`);
      const usecMs = this.ctx.nextTemp();
      this.ctx.emit(`${usecMs} = fdiv fast double ${usecDbl}, 1.000000e+03`);
      msValue = this.ctx.nextTemp();
      this.ctx.emit(`${msValue} = fadd fast double ${secMs}, ${usecMs}`);
    } else {
      msValue = this.ctx.ensureDouble(this.ctx.generateExpression(args[0], params));
    }

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds %Date, %Date* ${datePtr}, i32 0, i32 0`);
    this.ctx.emit(`store double ${msValue}, double* ${fieldPtr}`);

    this.ctx.setVariableType(datePtr, "%Date*");
    return datePtr;
  }

  /**
   * Generate 'this' keyword
   * Returns the current this pointer from class context
   */
  generateThis(): string {
    const thisPtr = this.ctx.getThisPointer();
    if (!thisPtr) {
      throw new Error("this keyword used outside of class method or constructor");
    }
    return thisPtr;
  }
}
