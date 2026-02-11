import { Expression, ArrayNode, ObjectNode, MapNode, SetNode, NewNode, RegexNode, ArrowFunctionNode, ConditionalExpressionNode, TemplateLiteralNode, MethodCallNode, AwaitExpressionNode, TypeAssertionNode, IndexAccessAssignmentNode, CallNode, IndexAccessNode, MemberAccessNode, VariableNode, BinaryNode, UnaryNode, NumberNode, StringNode, BooleanNode } from '../../ast/types.js';
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
  symbolTableGetScopeVarsArraysForClosure(): { names: string[]; types: string[] };
  setVariableType(name: string, type: string): void;
  nextTemp(): string;
  emit(instruction: string): void;
  setUsesPromises(value: boolean): void;
  getExpectedCallbackParamType(): string | null;
  getExpectedCallbackReturnType(): string | null;
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
    const exprTyped = expr as { type: string };
    if (!exprTyped.type || exprTyped.type.length === 0) {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i64 0 to i8*`);
      this.ctx.setVariableType(temp, 'i8*');
      return temp;
    }
    // Literals
    if (exprTyped.type === 'number') {
      const numExpr = expr as NumberNode;
      return this.literalGen.generateNumber(numExpr.value);
    }

    if (exprTyped.type === 'boolean') {
      const boolExpr = expr as BooleanNode;
      return this.literalGen.generateBoolean(boolExpr.value);
    }

    if (exprTyped.type === 'string') {
      const strExpr = expr as StringNode;
      return this.literalGen.generateString(strExpr.value);
    }

    if (exprTyped.type === 'null' || exprTyped.type === 'undefined') {
      this.ctx.setVariableType('null', 'i8*');
      return 'null';
    }

    if (exprTyped.type === 'regex') {
      const regexExpr = expr as RegexNode;
      return this.literalGen.generateRegex(regexExpr.pattern, regexExpr.flags);
    }

    if (exprTyped.type === 'array') {
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
      return this.literalGen.generateNew(newExpr.className, newExpr.args, params, newExpr.typeArgs);
    }

    if (exprTyped.type === 'this') {
      return this.literalGen.generateThis();
    }

    // Variables
    if (exprTyped.type === 'variable') {
      const varExpr = expr as VariableNode;
      return this.variableGen.generate(varExpr.name);
    }

    // Unary operators
    if (exprTyped.type === 'unary') {
      const unaryExpr = expr as UnaryNode;
      return this.unaryGen.generate(unaryExpr.op, unaryExpr.operand, params);
    }

    // Binary operators
    if (exprTyped.type === 'binary') {
      const binExpr = expr as BinaryNode;
      return this.binaryGen.generate(binExpr.op, binExpr.left, binExpr.right, params);
    }

    // Call expressions
    if (exprTyped.type === 'call') {
      return this.callGen.generate(expr as CallNode, params);
    }

    // Index access
    if (exprTyped.type === 'index_access') {
      return this.indexAccessGen.generate(expr as IndexAccessNode, params);
    }

    // Member access
    if (exprTyped.type === 'member_access') {
      return this.memberAccessGen.generate(expr as MemberAccessNode, params);
    }

    // Arrow functions
    if (exprTyped.type === 'arrow_function') {
      const scopeVarsResult = this.ctx.symbolTableGetScopeVarsArraysForClosure();
      const scopeVarsTyped = scopeVarsResult as { names: string[]; types: string[] };
      let typeHints: { paramTypes?: string[]; returnType?: string } | undefined = undefined;
      if (this.ctx.getExpectedCallbackParamType() || this.ctx.getExpectedCallbackReturnType()) {
        typeHints = {};
        const cbParamType = this.ctx.getExpectedCallbackParamType();
        if (cbParamType) {
          typeHints.paramTypes = [cbParamType];
        }
        const cbReturnType = this.ctx.getExpectedCallbackReturnType();
        if (cbReturnType) {
          typeHints.returnType = cbReturnType;
        }
      }
      return this.arrowFunctionGen.generateArrowFunction(expr as ArrowFunctionNode, params, typeHints, scopeVarsTyped.names, scopeVarsTyped.types);
    }

    // Conditional (ternary) expressions
    if (exprTyped.type === 'conditional') {
      return this.conditionalGen.generate(expr as ConditionalExpressionNode, params);
    }

    // Template literals
    if (exprTyped.type === 'template_literal') {
      return this.templateLiteralGen.generate(expr as TemplateLiteralNode, params);
    }

    // Method calls
    if (exprTyped.type === 'method_call') {
      return this.methodCallGen.generate(expr as MethodCallNode, params);
    }

    // Await expressions
    if (exprTyped.type === 'await') {
      const awaitExpr = expr as AwaitExpressionNode;
      const promiseReg = this.generate(awaitExpr.argument, params);
      const valueReg = this.ctx.nextTemp();
      this.ctx.emit(`${valueReg} = call i8* @__Promise_await(%Promise* ${promiseReg})`);
      this.ctx.setVariableType(valueReg, 'i8*');
      this.ctx.setUsesPromises(true);
      return valueReg;
    }

    // Type assertions (expr as Type) - evaluate inner expression, type info tracked at declaration level
    if (exprTyped.type === 'type_assertion') {
      const assertExpr = expr as TypeAssertionNode;
      return this.generate(assertExpr.expression, params);
    }

    // Index access assignment (arr[i] = value)
    if (exprTyped.type === 'index_access_assignment') {
      return this.indexAccessGen.generateAssignment(expr as IndexAccessAssignmentNode, params);
    }

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = inttoptr i64 0 to i8*`);
    this.ctx.setVariableType(temp, 'i8*');
    return temp;
  }

  /**
   * Get the arrow function generator (for accessing lifted functions)
   */
  getArrowFunctionGenerator(): ArrowFunctionExpressionGenerator {
    return this.arrowFunctionGen;
  }
}
