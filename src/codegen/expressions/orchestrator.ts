import { Expression, ArrayNode, ObjectNode, MapNode, SetNode, NewNode, RegexNode, ArrowFunctionNode, ConditionalExpressionNode, TemplateLiteralNode, MethodCallNode, AwaitExpressionNode, TypeAssertionNode } from '../../ast/types.js';
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
import type { SymbolTable } from '../infrastructure/symbol-table.js';

interface ExpressionOrchestratorContext {
  symbolTable: SymbolTable;
  variableTypes: Map<string, string>;
  usesPromises: boolean;
  nextTemp(): string;
  emit(instruction: string): void;
}

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
  public arrowFunctionGen: ArrowFunctionExpressionGenerator;
  private conditionalGen: ConditionalExpressionGenerator;
  private templateLiteralGen: TemplateLiteralGenerator;
  private methodCallGen: MethodCallGenerator;

  constructor(private ctx: ExpressionOrchestratorContext) {
    const subCtx = ctx as unknown;
    this.literalGen = new LiteralExpressionGenerator(subCtx as ConstructorParameters<typeof LiteralExpressionGenerator>[0]);
    this.variableGen = new VariableExpressionGenerator(subCtx as ConstructorParameters<typeof VariableExpressionGenerator>[0]);
    this.binaryGen = new BinaryExpressionGenerator(subCtx as ConstructorParameters<typeof BinaryExpressionGenerator>[0]);
    this.unaryGen = new UnaryExpressionGenerator(subCtx as ConstructorParameters<typeof UnaryExpressionGenerator>[0]);
    this.callGen = new CallExpressionGenerator(subCtx as ConstructorParameters<typeof CallExpressionGenerator>[0]);
    this.indexAccessGen = new IndexAccessGenerator(subCtx as ConstructorParameters<typeof IndexAccessGenerator>[0]);
    this.memberAccessGen = new MemberAccessGenerator(subCtx as ConstructorParameters<typeof MemberAccessGenerator>[0]);
    this.arrowFunctionGen = new ArrowFunctionExpressionGenerator();
    this.conditionalGen = new ConditionalExpressionGenerator(subCtx as ConstructorParameters<typeof ConditionalExpressionGenerator>[0]);
    this.templateLiteralGen = new TemplateLiteralGenerator(subCtx as ConstructorParameters<typeof TemplateLiteralGenerator>[0]);
    this.methodCallGen = new MethodCallGenerator(subCtx as ConstructorParameters<typeof MethodCallGenerator>[0]);
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

    if (expr.type === 'regex') {
      const regexExpr = expr as RegexNode;
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

    if (expr.type === 'this') {
      return this.literalGen.generateThis();
    }

    // Variables
    if (expr.type === 'variable') {
      return this.variableGen.generate(expr.name);
    }

    // Unary operators
    if (expr.type === 'unary') {
      return this.unaryGen.generate(expr.op, expr.operand, params);
    }

    // Binary operators
    if (expr.type === 'binary') {
      return this.binaryGen.generate(expr.op, expr.left, expr.right, params);
    }

    // Call expressions
    if (expr.type === 'call') {
      return this.callGen.generate(expr, params);
    }

    // Index access
    if (expr.type === 'index_access') {
      return this.indexAccessGen.generate(expr, params);
    }

    // Member access
    if (expr.type === 'member_access') {
      return this.memberAccessGen.generate(expr, params);
    }

    // Arrow functions
    if (expr.type === 'arrow_function') {
      const scopeVars = this.ctx.symbolTable.getScopeVarsForClosure();
      return this.arrowFunctionGen.generateArrowFunction(expr as ArrowFunctionNode, params, undefined, scopeVars);
    }

    // Conditional (ternary) expressions
    if (expr.type === 'conditional') {
      return this.conditionalGen.generate(expr as ConditionalExpressionNode, params);
    }

    // Template literals
    if (expr.type === 'template_literal') {
      return this.templateLiteralGen.generate(expr as TemplateLiteralNode, params);
    }

    // Method calls
    if (expr.type === 'method_call') {
      return this.methodCallGen.generate(expr as MethodCallNode, params);
    }

    // Await expressions
    if (expr.type === 'await') {
      const awaitExpr = expr as AwaitExpressionNode;
      const promiseReg = this.generate(awaitExpr.argument, params);
      const valueReg = this.ctx.nextTemp();
      this.ctx.emit(`${valueReg} = call i8* @__Promise_get_value(%Promise* ${promiseReg})`);
      this.ctx.variableTypes.set(valueReg, 'i8*');
      this.ctx.usesPromises = true;
      return valueReg;
    }

    // Type assertions (expr as Type) - evaluate inner expression, type info tracked at declaration level
    if (expr.type === 'type_assertion') {
      const assertExpr = expr as TypeAssertionNode;
      return this.generate(assertExpr.expression, params);
    }

    throw new Error(`Unknown expression type: ${expr.type}`);
  }

  /**
   * Get the arrow function generator (for accessing lifted functions)
   */
  getArrowFunctionGenerator(): ArrowFunctionExpressionGenerator {
    return this.arrowFunctionGen;
  }
}
