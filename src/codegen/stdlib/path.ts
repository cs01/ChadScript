import { MethodCallNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

/**
 * Path Method Generator
 *
 * Generates LLVM IR for path.* methods using POSIX path functions.
 *
 * Supported methods:
 * - path.resolve(path) → realpath() syscall
 * - path.dirname(path) → dirname() function
 */
export class PathGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Check if this method call is a path.* method
   */
  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    return exprObjBase.type === 'variable' &&
           (expr.object as any).name === 'path' &&
           (expr.method === 'resolve' || expr.method === 'dirname' || expr.method === 'basename');
  }

  /**
   * Generate LLVM IR for path.resolve(path)
   * Uses realpath() POSIX function to resolve path
   */
  generateResolve(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('path.resolve() requires at least 1 argument');
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    // Allocate buffer for resolved path (PATH_MAX = 4096)
    const bufferSize = this.ctx.nextTemp();
    this.ctx.emit(`${bufferSize} = add i64 0, 4096`);
    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

    // Call realpath: realpath(path, buffer)
    const resolvedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resolvedPtr} = call i8* @realpath(i8* ${pathPtr}, i8* ${buffer})`);

    // If realpath returns NULL, return the original path
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${resolvedPtr}, null`);

    const successLabel = this.ctx.nextLabel('resolve_success');
    const failLabel = this.ctx.nextLabel('resolve_fail');
    const endLabel = this.ctx.nextLabel('resolve_end');

    this.ctx.emit(`br i1 ${isNull}, label %${failLabel}, label %${successLabel}`);

    // Success: return resolved path
    this.ctx.emit(`${successLabel}:`);
    this.ctx.emit(`br label %${endLabel}`);

    // Failure: GC will handle cleanup, return original path
    this.ctx.emit(`${failLabel}:`);
    this.ctx.emit(`br label %${endLabel}`);

    // End: phi node
    this.ctx.emit(`${endLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i8* [ ${resolvedPtr}, %${successLabel} ], [ ${pathPtr}, %${failLabel} ]`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  /**
   * Generate LLVM IR for path.dirname(path)
   * Uses dirname() POSIX function
   */
  generateDirname(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('path.dirname() requires 1 argument');
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    // dirname() modifies its argument, so we need to make a copy
    const pathLen = this.ctx.nextTemp();
    this.ctx.emit(`${pathLen} = call i64 @strlen(i8* ${pathPtr})`);
    const copySize = this.ctx.nextTemp();
    this.ctx.emit(`${copySize} = add i64 ${pathLen}, 1`);
    const pathCopy = this.ctx.nextTemp();
    this.ctx.emit(`${pathCopy} = call i8* @GC_malloc_atomic(i64 ${copySize})`);
    const copyResult = this.ctx.nextTemp();
    this.ctx.emit(`${copyResult} = call i8* @strcpy(i8* ${pathCopy}, i8* ${pathPtr})`);

    // Call dirname: dirname(pathCopy)
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @dirname(i8* ${pathCopy})`);

    return result;
  }

  generateBasename(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('path.basename() requires 1 argument');
    }

    const pathPtr = this.ctx.generateExpression(expr.args[0], params);

    const pathLen = this.ctx.nextTemp();
    this.ctx.emit(`${pathLen} = call i64 @strlen(i8* ${pathPtr})`);
    const copySize = this.ctx.nextTemp();
    this.ctx.emit(`${copySize} = add i64 ${pathLen}, 1`);
    const pathCopy = this.ctx.nextTemp();
    this.ctx.emit(`${pathCopy} = call i8* @GC_malloc_atomic(i64 ${copySize})`);
    const copyResult = this.ctx.nextTemp();
    this.ctx.emit(`${copyResult} = call i8* @strcpy(i8* ${pathCopy}, i8* ${pathPtr})`);

    const basenamePtr = this.ctx.nextTemp();
    this.ctx.emit(`${basenamePtr} = call i8* @basename(i8* ${pathCopy})`);

    const resultLen = this.ctx.nextTemp();
    this.ctx.emit(`${resultLen} = call i64 @strlen(i8* ${basenamePtr})`);
    const resultSize = this.ctx.nextTemp();
    this.ctx.emit(`${resultSize} = add i64 ${resultLen}, 1`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @GC_malloc_atomic(i64 ${resultSize})`);
    const strdupResult = this.ctx.nextTemp();
    this.ctx.emit(`${strdupResult} = call i8* @strcpy(i8* ${result}, i8* ${basenamePtr})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }
}
