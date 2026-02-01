import { Expression, ArrayNode, ObjectNode, MapNode, SetNode, NewNode } from '../../ast/types.js';
import { LiteralExpressionGenerator } from './literals.js';
import { VariableExpressionGenerator } from './variables.js';
import { BinaryExpressionGenerator } from './operators/binary.js';
import { UnaryExpressionGenerator } from './operators/unary.js';
import { CallExpressionGenerator } from './calls.js';
import { IndexAccessGenerator } from './access/index.js';
import { MemberAccessGenerator } from './access/member.js';
import { ArrowFunctionExpressionGenerator } from './arrow-functions.js';
import { ConditionalExpressionGenerator } from './conditionals.js';
import { TemplateLiteralGenerator } from './templates.js';
import { MethodCallGenerator } from './method-calls.js';

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
 * - ConditionalExpressionGenerator: ternary conditional expressions
 * - TemplateLiteralGenerator: template literal strings with interpolation
 * - MethodCallGenerator: method calls on objects, strings, arrays, etc.
 */
export class ExpressionGenerator {
  private literalGen: LiteralExpressionGenerator;
  private variableGen: VariableExpressionGenerator;
  private binaryGen: BinaryExpressionGenerator;
  private unaryGen: UnaryExpressionGenerator;
  private callGen: CallExpressionGenerator;
  private indexAccessGen: IndexAccessGenerator;
  private memberAccessGen: MemberAccessGenerator;
  private arrowFunctionGen: ArrowFunctionExpressionGenerator;
  private conditionalGen: ConditionalExpressionGenerator;
  private templateLiteralGen: TemplateLiteralGenerator;
  private methodCallGen: MethodCallGenerator;

  constructor(private ctx: any) {
    this.literalGen = new LiteralExpressionGenerator(ctx);
    this.variableGen = new VariableExpressionGenerator(ctx);
    this.binaryGen = new BinaryExpressionGenerator(ctx);
    this.unaryGen = new UnaryExpressionGenerator(ctx);
    this.callGen = new CallExpressionGenerator(ctx);
    this.indexAccessGen = new IndexAccessGenerator(ctx);
    this.memberAccessGen = new MemberAccessGenerator(ctx);
    this.arrowFunctionGen = new ArrowFunctionExpressionGenerator();
    this.conditionalGen = new ConditionalExpressionGenerator(ctx);
    this.templateLiteralGen = new TemplateLiteralGenerator(ctx);
    this.methodCallGen = new MethodCallGenerator(ctx);
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
      return this.literalGen.generateArray(expr as ArrayNode, params);
    }

    if ((expr as ObjectNode).type === 'object') {
      return this.literalGen.generateObject(expr as ObjectNode, params);
    }

    if ((expr as MapNode).type === 'map') {
      return this.literalGen.generateMap(expr as MapNode, params);
    }

    if ((expr as SetNode).type === 'set') {
      return this.literalGen.generateSet(expr as SetNode, params);
    }

    if ((expr as NewNode).type === 'new') {
      const newExpr = expr as NewNode;
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

    // Call expressions
    if (expr.type === 'call') {
      return this.callGen.generate(expr, params, this.generate.bind(this));
    }

    // Index access
    if (expr.type === 'index_access') {
      return this.indexAccessGen.generate(expr, params, this.generate.bind(this));
    }

    // Member access
    if (expr.type === 'member_access') {
      return this.memberAccessGen.generate(expr, params, this.generate.bind(this));
    }

    // Arrow functions
    if ((expr as any).type === 'arrow_function') {
      const scopeVars = this.ctx.symbolTable.getScopeVarsForClosure();
      return this.arrowFunctionGen.generateArrowFunction(expr, params, undefined, scopeVars);
    }

    // Conditional (ternary) expressions
    if ((expr as any).type === 'conditional') {
      return this.conditionalGen.generate(expr, params);
    }

    // Template literals
    if ((expr as any).type === 'template_literal') {
      return this.templateLiteralGen.generate(expr, params);
    }

    // Method calls
    if (expr.type === 'method_call') {
      return this.methodCallGen.generate(expr as any, params);
    }

    // Await expressions
    if ((expr as any).type === 'await') {
      const awaitExpr = expr as any;
      const promiseReg = this.generate(awaitExpr.argument, params);
      const valueReg = this.ctx.nextTemp();
      this.ctx.emit(`${valueReg} = call i8* @__Promise_get_value(%Promise* ${promiseReg})`);
      this.ctx.variableTypes.set(valueReg, 'i8*');
      this.ctx.usesPromises = true;
      return valueReg;
    }

    throw new Error(`Unknown expression type: ${(expr as any).type}`);
  }

  /**
   * Get the arrow function generator (for accessing lifted functions)
   */
  getArrowFunctionGenerator(): ArrowFunctionExpressionGenerator {
    return this.arrowFunctionGen;
  }
}
