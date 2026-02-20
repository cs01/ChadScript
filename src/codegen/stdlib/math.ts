import { MethodCallNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

/**
 * Math Method Generator
 *
 * Generates LLVM IR for Math.* methods using LLVM intrinsics.
 * All Math methods are pure functions with no side effects.
 *
 * Supported methods:
 * - Math.sqrt(x) → llvm.sqrt.f64
 * - Math.pow(base, exp) → llvm.pow.f64
 * - Math.floor(x) → llvm.floor.f64
 * - Math.ceil(x) → llvm.ceil.f64
 * - Math.round(x) → llvm.round.f64
 * - Math.abs(x) → llvm.fabs.f64
 */
export class MathGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Check if this method call is a Math.* method
   */
  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== "Math") return false;
    return this.getSupportedMethods().indexOf(expr.method) !== -1;
  }

  /**
   * Get list of supported Math methods
   */
  getSupportedMethods(): string[] {
    return ["sqrt", "pow", "floor", "ceil", "round", "abs", "max", "min"];
  }

  /**
   * Generate LLVM IR for Math method call
   *
   * @param expr Method call node (must be Math.*)
   * @param params Function parameters for expression generation
   * @returns LLVM register containing result
   */
  generateMathMethod(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;

    switch (method) {
      case "sqrt":
        return this.generateSqrt(expr, params);
      case "pow":
        return this.generatePow(expr, params);
      case "floor":
        return this.generateFloor(expr, params);
      case "ceil":
        return this.generateCeil(expr, params);
      case "round":
        return this.generateRound(expr, params);
      case "abs":
        return this.generateAbs(expr, params);
      case "max":
        return this.generateMax(expr, params);
      case "min":
        return this.generateMin(expr, params);
      default:
        return this.ctx.emitError(`Unsupported Math method: ${method}`, expr.loc);
    }
  }

  /**
   * Generate Math.sqrt(x) → llvm.sqrt.f64(double x)
   */
  private generateSqrt(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.sqrt() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.sqrt.f64(double ${dblArg})`);
    return result;
  }

  /**
   * Generate Math.pow(base, exp) → llvm.pow.f64(double base, double exp)
   */
  private generatePow(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 2) {
      return this.ctx.emitError("Math.pow() requires 2 arguments", expr.loc);
    }
    const base = this.ctx.generateExpression(expr.args[0], params);
    const exp = this.ctx.generateExpression(expr.args[1], params);
    const dblBase = this.ctx.ensureDouble(base);
    const dblExp = this.ctx.ensureDouble(exp);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.pow.f64(double ${dblBase}, double ${dblExp})`);
    return result;
  }

  /**
   * Generate Math.floor(x) → llvm.floor.f64(double x)
   */
  private generateFloor(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.floor() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.floor.f64(double ${dblArg})`);
    return result;
  }

  /**
   * Generate Math.ceil(x) → llvm.ceil.f64(double x)
   */
  private generateCeil(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.ceil() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.ceil.f64(double ${dblArg})`);
    return result;
  }

  /**
   * Generate Math.round(x) → llvm.round.f64(double x)
   */
  private generateRound(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.round() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.round.f64(double ${dblArg})`);
    return result;
  }

  /**
   * Generate Math.abs(x) → llvm.fabs.f64(double x)
   */
  private generateAbs(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.abs() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.fabs.f64(double ${dblArg})`);
    return result;
  }

  private generateMax(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 2) {
      return this.ctx.emitError("Math.max() requires 2 arguments", expr.loc);
    }
    const a = this.ctx.generateExpression(expr.args[0], params);
    const b = this.ctx.generateExpression(expr.args[1], params);
    const dblA = this.ctx.ensureDouble(a);
    const dblB = this.ctx.ensureDouble(b);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.maxnum.f64(double ${dblA}, double ${dblB})`);
    return result;
  }

  private generateMin(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 2) {
      return this.ctx.emitError("Math.min() requires 2 arguments", expr.loc);
    }
    const a = this.ctx.generateExpression(expr.args[0], params);
    const b = this.ctx.generateExpression(expr.args[1], params);
    const dblA = this.ctx.ensureDouble(a);
    const dblB = this.ctx.ensureDouble(b);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.minnum.f64(double ${dblA}, double ${dblB})`);
    return result;
  }
}
