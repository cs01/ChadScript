import { MethodCallNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

/**
 * Process Method Generator
 *
 * Generates LLVM IR for process.* methods.
 * Currently supports process.exit() only.
 *
 * Supported methods:
 * - process.exit(code?) → Flushes stdout and calls exit()
 *   - code: Optional exit code (defaults to 0)
 */
export class ProcessGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Check if this method call is a process.* method
   */
  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== 'variable') return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== 'process') return false;
    return expr.method === 'exit';
  }

  /**
   * Generate LLVM IR for process.exit(code?)
   *
   * Implementation:
   * 1. Convert exit code from double to i32 (defaults to 0)
   * 2. Flush stdout to ensure all output is printed
   * 3. Call exit(code) syscall
   *
   * @param expr Method call node (must be process.exit)
   * @param params Function parameters for expression generation
   * @returns Dummy value '0' (exit doesn't return)
   */
  generateProcessExit(expr: MethodCallNode, params: string[]): string {
    // Get exit code argument (defaults to 0)
    const exitCodeDouble = expr.args.length > 0
      ? this.ctx.generateExpression(expr.args[0], params)
      : '0.0';

    // Convert double to i32 for exit code (truncates decimal)
    const exitCode = this.ctx.nextTemp();
    if (exitCodeDouble === '0.0') {
      // Optimization: Use constant 0 directly
      this.ctx.emit(`${exitCode} = add i32 0, 0`);
    } else {
      // Convert double to i32
      this.ctx.emit(`${exitCode} = fptosi double ${exitCodeDouble} to i32`);
    }

    // Flush stdout before exiting to ensure all output is printed
    const stdoutPtr = this.ctx.nextTemp();
    this.ctx.emit(`${stdoutPtr} = load i8*, i8** @stdout`);
    const flushResult = this.ctx.nextTemp();
    this.ctx.emit(`${flushResult} = call i32 @fflush(i8* ${stdoutPtr})`);

    // Call exit syscall (noreturn)
    this.ctx.emit(`call void @exit(i32 ${exitCode})`);

    // Return a dummy value since exit doesn't return
    return '0';
  }
}
