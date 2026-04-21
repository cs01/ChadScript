import { MethodCallNode, VariableNode } from "../../ast/types.js";

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
    const varNode = expr.object as VariableNode;
    if (varNode.name !== "Math") return false;
    return this.getSupportedMethods().indexOf(expr.method) !== -1;
  }

  /**
   * Get list of supported Math methods
   */
  getSupportedMethods(): string[] {
    return [
      "sqrt",
      "pow",
      "floor",
      "ceil",
      "round",
      "abs",
      "max",
      "min",
      "trunc",
      "log",
      "sin",
      "cos",
      "sign",
      "random",
    ];
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
      case "trunc":
        return this.generateTrunc(expr, params);
      case "log":
        return this.generateLog(expr, params);
      case "sin":
        return this.generateSin(expr, params);
      case "cos":
        return this.generateCos(expr, params);
      case "sign":
        return this.generateSign(expr, params);
      case "random":
        return this.generateRandom(expr);
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
    return this.ctx.emitCall("double", "@llvm.sqrt.f64", this.ctx.emitOperand(dblArg, "double"));
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
    const args = `${this.ctx.emitOperand(dblBase, "double")}, ${this.ctx.emitOperand(dblExp, "double")}`;
    return this.ctx.emitCall("double", "@llvm.pow.f64", args);
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
    return this.ctx.emitCall("double", "@llvm.floor.f64", this.ctx.emitOperand(dblArg, "double"));
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
    return this.ctx.emitCall("double", "@llvm.ceil.f64", this.ctx.emitOperand(dblArg, "double"));
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
    return this.ctx.emitCall("double", "@llvm.round.f64", this.ctx.emitOperand(dblArg, "double"));
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
    return this.ctx.emitCall("double", "@llvm.fabs.f64", this.ctx.emitOperand(dblArg, "double"));
  }

  private generateMax(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("Math.max() requires at least 2 arguments", expr.loc);
    }
    let current = this.ctx.ensureDouble(this.ctx.generateExpression(expr.args[0], params));
    for (let i = 1; i < expr.args.length; i++) {
      const next = this.ctx.ensureDouble(this.ctx.generateExpression(expr.args[i], params));
      const args = `${this.ctx.emitOperand(current, "double")}, ${this.ctx.emitOperand(next, "double")}`;
      current = this.ctx.emitCall("double", "@llvm.maximum.f64", args);
    }
    return current;
  }

  private generateTrunc(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.trunc() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    return this.ctx.emitCall("double", "@llvm.trunc.f64", this.ctx.emitOperand(dblArg, "double"));
  }

  private generateRandom(expr: MethodCallNode): string {
    this.ctx.setUsesMathRandom(true);
    return this.ctx.emitCall("double", "@drand48", "");
  }

  private generateSign(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.sign() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    const dblOp = this.ctx.emitOperand(dblArg, "double");
    const isNaN = this.ctx.nextTemp();
    this.ctx.emit(`${isNaN} = fcmp uno ${dblOp}, ${dblArg}`);
    const isPos = this.ctx.nextTemp();
    this.ctx.emit(`${isPos} = fcmp ogt ${dblOp}, 0.0`);
    const isNeg = this.ctx.nextTemp();
    this.ctx.emit(`${isNeg} = fcmp olt ${dblOp}, 0.0`);
    const posVal = this.ctx.nextTemp();
    this.ctx.emit(`${posVal} = select i1 ${isPos}, double 1.0, double 0.0`);
    const negVal = this.ctx.nextTemp();
    this.ctx.emit(
      `${negVal} = select i1 ${isNeg}, double -1.0, ${this.ctx.emitOperand(posVal, "double")}`,
    );
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = select i1 ${isNaN}, double 0x7FF8000000000000, ${this.ctx.emitOperand(negVal, "double")}`,
    );
    return result;
  }

  private generateLog(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.log() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    return this.ctx.emitCall("double", "@llvm.log.f64", this.ctx.emitOperand(dblArg, "double"));
  }

  private generateSin(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.sin() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    return this.ctx.emitCall("double", "@llvm.sin.f64", this.ctx.emitOperand(dblArg, "double"));
  }

  private generateCos(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      return this.ctx.emitError("Math.cos() requires 1 argument", expr.loc);
    }
    const arg = this.ctx.generateExpression(expr.args[0], params);
    const dblArg = this.ctx.ensureDouble(arg);
    return this.ctx.emitCall("double", "@llvm.cos.f64", this.ctx.emitOperand(dblArg, "double"));
  }

  private generateMin(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.ctx.emitError("Math.min() requires at least 2 arguments", expr.loc);
    }
    let current = this.ctx.ensureDouble(this.ctx.generateExpression(expr.args[0], params));
    for (let i = 1; i < expr.args.length; i++) {
      const next = this.ctx.ensureDouble(this.ctx.generateExpression(expr.args[i], params));
      const args = `${this.ctx.emitOperand(current, "double")}, ${this.ctx.emitOperand(next, "double")}`;
      current = this.ctx.emitCall("double", "@llvm.minimum.f64", args);
    }
    return current;
  }
}
