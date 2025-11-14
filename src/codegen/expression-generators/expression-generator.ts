import { Expression } from '../../ast/types.js';
import { LiteralExpressionGenerator } from './literal-expression-generator.js';
import { VariableExpressionGenerator } from './variable-expression-generator.js';
import { BinaryExpressionGenerator } from './binary-expression-generator.js';
import { UnaryExpressionGenerator } from './unary-expression-generator.js';

/**
 * ExpressionGenerator
 *
 * Main orchestrator for generating LLVM IR from expressions.
 * Delegates to specialized sub-generators based on expression type.
 *
 * Architecture:
 * - LiteralExpressionGenerator: numbers, booleans, strings, etc.
 * - VariableExpressionGenerator: all variable types
 * - BinaryExpressionGenerator: arithmetic, bitwise, comparison operators
 * - UnaryExpressionGenerator: !, -, + operators
 * - (More sub-generators to be extracted in future commits)
 */
export class ExpressionGenerator {
  private literalGen: LiteralExpressionGenerator;
  private variableGen: VariableExpressionGenerator;
  private binaryGen: BinaryExpressionGenerator;
  private unaryGen: UnaryExpressionGenerator;

  constructor(private ctx: any) {
    this.literalGen = new LiteralExpressionGenerator(ctx);
    this.variableGen = new VariableExpressionGenerator(ctx);
    this.binaryGen = new BinaryExpressionGenerator(ctx);
    this.unaryGen = new UnaryExpressionGenerator(ctx);
  }

  /**
   * Generate LLVM IR for any expression
   * Delegates to appropriate sub-generator based on expression type
   */
  generate(expr: Expression, params: string[]): string {
    // Literals
    if (expr.type === 'number') {
      return this.literalGen.generateNumber(expr.value);
    }

    if (expr.type === 'boolean') {
      return this.literalGen.generateBoolean(expr.value);
    }

    if (expr.type === 'string') {
      return this.literalGen.generateString(expr.value);
    }

    if ((expr as any).type === 'regex') {
      const regexExpr = expr as any;
      return this.literalGen.generateRegex(regexExpr.pattern, regexExpr.flags);
    }

    if (expr.type === 'array') {
      return this.literalGen.generateArray(expr, params);
    }

    if ((expr as any).type === 'object') {
      return this.literalGen.generateObject(expr, params);
    }

    if ((expr as any).type === 'map') {
      return this.literalGen.generateMap(expr, params);
    }

    if ((expr as any).type === 'set') {
      return this.literalGen.generateSet(expr, params);
    }

    if ((expr as any).type === 'new') {
      const newExpr = expr as any;
      return this.literalGen.generateNew(newExpr.className, newExpr.args, params);
    }

    if ((expr as any).type === 'this') {
      return this.literalGen.generateThis();
    }

    // Variables
    if (expr.type === 'variable') {
      return this.variableGen.generate(expr.name);
    }

    // Unary operators
    if (expr.type === 'unary') {
      return this.unaryGen.generate(expr.op, expr.operand, params, this.generate.bind(this));
    }

    // Binary operators
    if (expr.type === 'binary') {
      return this.binaryGen.generate(expr.op, expr.left, expr.right, params, this.generate.bind(this));
    }

    // TODO: Extract these into sub-generators in future commits
    // For now, delegate back to llvm-generator's original implementation
    // This allows us to wire up the new pattern without breaking anything

    if (expr.type === 'member_access' ||
        expr.type === 'index_access' ||
        expr.type === 'call' ||
        expr.type === 'method_call' ||
        (expr as any).type === 'arrow_function' ||
        (expr as any).type === 'conditional' ||
        (expr as any).type === 'template_literal') {
      // Delegate to original implementation via callback
      // The parent llvm-generator will set this callback
      if (!this.ctx.generateExpressionFallback) {
        throw new Error('generateExpressionFallback not set - cannot handle complex expression types');
      }
      return this.ctx.generateExpressionFallback(expr, params);
    }

    throw new Error(`Unknown expression type: ${(expr as any).type}`);
  }
}
