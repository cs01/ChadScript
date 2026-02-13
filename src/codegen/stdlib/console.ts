import { Expression, MethodCallNode, VariableNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

/**
 * Console Method Generator
 *
 * Generates LLVM IR for console.log(), console.error(), and console.warn() methods.
 * Uses printf for stdout and fprintf for stderr.
 *
 * Supported methods:
 * - console.log(value) → printf to stdout
 * - console.error(value) → fprintf to stderr
 * - console.warn(value) → fprintf to stderr (same as error)
 *
 * Supported value types:
 * - Strings: Uses "%s\n" format
 * - Numbers: Uses "%g\n" format (auto-formats integers/floats)
 * - No arguments: Prints just "\n"
 */
export class ConsoleGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Check if this method call is a console.* method
   */
  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    const objType = exprObjBase.type;
    if (objType !== 'variable') {
      return false;
    }
    const varNode = expr.object as VariableNode;
    const name = varNode.name;
    if (name !== 'console') {
      return false;
    }
    const method = expr.method;
    const result = method === 'log' || method === 'error' || method === 'warn' || method === 'debug';
    return result;
  }

  /**
   * Generate LLVM IR for console method call
   *
   * @param method 'log' or 'error'
   * @param args Array of arguments to print
   * @param params Function parameters for expression generation
   * @returns LLVM register containing result (i32 from printf/fprintf)
   */
  generateConsoleCall(method: string, args: Expression[], params: string[]): string {
    // Handle console.log() with no args - just print newline
    if (args.length === 0) {
      return this.generateNewline(method);
    }

    // Handle console.log(value) - print first argument
    // For simplicity, we only handle one argument at a time
    const arg = args[0];
    const argTyped = arg as { type: string; name: string };
    const argValue = this.ctx.generateExpression(arg, params);
    const isString = this.ctx.isStringExpression(arg);

    // Check if it's a Response object (from fetch())
    if (argTyped.type === 'variable') {
      const varType = this.ctx.getVariableType(argTyped.name);
      if (varType === '%__FetchResponse*') {
        return this.generateResponsePrint(method, argValue);
      }
    }

    if (isString) {
      return this.generateStringPrint(method, argValue);
    } else {
      return this.generateNumberPrint(method, argValue);
    }
  }

  /**
   * Generate code to print just a newline
   */
  private generateNewline(method: string): string {
    const formatStr = this.ctx.createStringConstant('\n');
    const temp = this.ctx.nextTemp();

    if (method === 'error' || method === 'warn') {
      // fprintf(stderr, "\n")
      this.ctx.emit(`${temp} = load i8*, i8** @stderr`);
      const temp2 = this.ctx.nextTemp();
      this.ctx.emit(`${temp2} = call i32 (i8*, i8*, ...) @fprintf(i8* ${temp}, i8* ${formatStr})`);
      return temp2;
    } else {
      // printf("\n")
      this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${formatStr})`);
      const flushTemp = this.ctx.nextTemp();
      this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* null)`);
      return temp;
    }
  }

  /**
   * Generate code to print a string value
   */
  private generateStringPrint(method: string, argValue: string): string {
    const formatStr = this.ctx.createStringConstant('%s\n');
    const temp = this.ctx.nextTemp();

    if (method === 'error' || method === 'warn') {
      // fprintf(stderr, "%s\n", value)
      this.ctx.emit(`${temp} = load i8*, i8** @stderr`);
      const temp2 = this.ctx.nextTemp();
      this.ctx.emit(`${temp2} = call i32 (i8*, i8*, ...) @fprintf(i8* ${temp}, i8* ${formatStr}, i8* ${argValue})`);
      const flushTemp = this.ctx.nextTemp();
      this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${temp})`);
      return temp2;
    } else {
      // printf("%s\n", value)
      this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${formatStr}, i8* ${argValue})`);
      const flushTemp = this.ctx.nextTemp();
      this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* null)`);
      return temp;
    }
  }

  /**
   * Generate code to print a number value
   */
  private generateNumberPrint(method: string, argValue: string): string {
    const formatStr = this.ctx.createStringConstant('%.15g\n');
    const temp = this.ctx.nextTemp();

    if (method === 'error' || method === 'warn') {
      // fprintf(stderr, "%g\n", value)
      this.ctx.emit(`${temp} = load i8*, i8** @stderr`);
      const temp2 = this.ctx.nextTemp();
      this.ctx.emit(`${temp2} = call i32 (i8*, i8*, ...) @fprintf(i8* ${temp}, i8* ${formatStr}, double ${argValue})`);
      return temp2;
    } else {
      // printf("%g\n", value)
      this.ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${formatStr}, double ${argValue})`);
      const flushTemp = this.ctx.nextTemp();
      this.ctx.emit(`${flushTemp} = call i32 @fflush(i8* null)`);
      return temp;
    }
  }

  private generateResponsePrint(method: string, argValue: string): string {
    // Extract the body field from Response* and print it as a string
    // Response = { i8* raw, i32 status, i8* body }
    const bodyPtr = this.ctx.nextTemp();
    this.ctx.emit(`${bodyPtr} = getelementptr %__FetchResponse, %__FetchResponse* ${argValue}, i32 0, i32 2`);
    const body = this.ctx.nextTemp();
    this.ctx.emit(`${body} = load i8*, i8** ${bodyPtr}`);
    return this.generateStringPrint(method, body);
  }
}
