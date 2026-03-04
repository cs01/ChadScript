import {
  Expression,
  ArrayNode,
  ObjectNode,
  MapNode,
  SetNode,
  NewNode,
  RegexNode,
  ArrowFunctionNode,
  ConditionalExpressionNode,
  TemplateLiteralNode,
  MethodCallNode,
  AwaitExpressionNode,
  TypeAssertionNode,
  IndexAccessAssignmentNode,
  CallNode,
  IndexAccessNode,
  MemberAccessNode,
  VariableNode,
  BinaryNode,
  UnaryNode,
  NumberNode,
  StringNode,
  BooleanNode,
} from "../../ast/types.js";
import { LiteralExpressionGenerator } from "./literals.js";
import { VariableExpressionGenerator } from "./variables.js";
import { BinaryExpressionGenerator } from "./operators/binary.js";
import { UnaryExpressionGenerator } from "./operators/unary.js";
import { CallExpressionGenerator } from "./calls.js";
import { IndexAccessGenerator } from "./access/index.js";
import { MemberAccessGenerator } from "./access/member.js";
import { ArrowFunctionExpressionGenerator } from "./arrow-functions.js";
import { ConditionalExpressionGenerator } from "./conditionals.js";
import { TemplateLiteralGenerator } from "./templates.js";
import { MethodCallGenerator } from "./method-calls.js";
import type { SymbolTable } from "../infrastructure/symbol-table.js";

interface ExpressionOrchestratorContext {
  readonly symbolTable: SymbolTable;
  setVariableType(name: string, type: string): void;
  nextTemp(): string;
  emit(instruction: string): void;
  setUsesPromises(value: boolean): void;
  getExpectedCallbackParamType(): string | null;
  getExpectedCallbackReturnType(): string | null;
  setLastInlineLambdaEnvPtr(ptr: string | null): void;
  setLastTypeAssertionSourceVar(name: string | null): void;
  emitWarning(message: string, loc?: { line: number; column: number }, suggestion?: string): void;
  emitError(message: string, loc?: { line: number; column: number }, suggestion?: string): never;
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
    this.literalGen = new LiteralExpressionGenerator(
      subCtx as ConstructorParameters<typeof LiteralExpressionGenerator>[0],
    );
    this.variableGen = new VariableExpressionGenerator(
      subCtx as ConstructorParameters<typeof VariableExpressionGenerator>[0],
    );
    this.binaryGen = new BinaryExpressionGenerator(
      subCtx as ConstructorParameters<typeof BinaryExpressionGenerator>[0],
    );
    this.unaryGen = new UnaryExpressionGenerator(
      subCtx as ConstructorParameters<typeof UnaryExpressionGenerator>[0],
    );
    this.callGen = new CallExpressionGenerator(
      subCtx as ConstructorParameters<typeof CallExpressionGenerator>[0],
    );
    this.indexAccessGen = new IndexAccessGenerator(
      subCtx as ConstructorParameters<typeof IndexAccessGenerator>[0],
    );
    this.memberAccessGen = new MemberAccessGenerator(
      subCtx as ConstructorParameters<typeof MemberAccessGenerator>[0],
    );
    this.arrowFunctionGen = new ArrowFunctionExpressionGenerator();
    this.conditionalGen = new ConditionalExpressionGenerator(
      subCtx as ConstructorParameters<typeof ConditionalExpressionGenerator>[0],
    );
    this.templateLiteralGen = new TemplateLiteralGenerator(
      subCtx as ConstructorParameters<typeof TemplateLiteralGenerator>[0],
    );
    this.methodCallGen = new MethodCallGenerator(
      subCtx as ConstructorParameters<typeof MethodCallGenerator>[0],
    );
  }

  /**
   * Generate LLVM IR for any expression
   * Delegates to appropriate sub-generator based on expression type
   */
  generate(expr: Expression, params: string[]): string {
    const exprTyped = expr as { type: string };
    if (!exprTyped.type || exprTyped.type.length === 0) {
      // Hard error: expressions must have a type. An empty type indicates a parser
      // or AST construction bug. Previously this silently generated a null pointer,
      // which LLVM -O2 could exploit as UB to prune unrelated code paths.
      this.ctx.emitError(
        "expression has empty type — this likely indicates a parser bug",
        (expr as { loc?: { line: number; column: number } }).loc,
      );
    }
    // Literals
    if (exprTyped.type === "number") {
      const numExpr = expr as NumberNode;
      return this.literalGen.generateNumber(numExpr.value);
    }

    if (exprTyped.type === "boolean") {
      const boolExpr = expr as BooleanNode;
      return this.literalGen.generateBoolean(boolExpr.value);
    }

    if (exprTyped.type === "string") {
      const strExpr = expr as StringNode;
      return this.literalGen.generateString(strExpr.value);
    }

    if (exprTyped.type === "null" || exprTyped.type === "undefined") {
      this.ctx.setVariableType("null", "i8*");
      return "null";
    }

    if (exprTyped.type.indexOf("spread:") === 0) {
      const varName = exprTyped.type.substr(7);
      return this.variableGen.generate(varName);
    }

    if (exprTyped.type === "regex") {
      const regexExpr = expr as RegexNode;
      return this.literalGen.generateRegex(regexExpr.pattern, regexExpr.flags);
    }

    if (exprTyped.type === "array") {
      return this.literalGen.generateArray(expr as ArrayNode, params);
    }

    if ((expr as ObjectNode).type === "object") {
      return this.literalGen.generateObject(expr as ObjectNode, params);
    }

    if ((expr as MapNode).type === "map") {
      return this.literalGen.generateMap(expr as MapNode, params);
    }

    if ((expr as SetNode).type === "set") {
      return this.literalGen.generateSet(expr as SetNode, params);
    }

    if ((expr as NewNode).type === "new") {
      const newExpr = expr as NewNode;
      return this.literalGen.generateNew(newExpr.className, newExpr.args, params, newExpr.typeArgs);
    }

    if (exprTyped.type === "this") {
      return this.literalGen.generateThis();
    }

    // Variables
    if (exprTyped.type === "variable") {
      const varExpr = expr as VariableNode;
      return this.variableGen.generate(varExpr.name);
    }

    // Unary operators
    if (exprTyped.type === "unary") {
      const unaryExpr = expr as UnaryNode;
      return this.unaryGen.generate(unaryExpr.op, unaryExpr.operand, params);
    }

    // Binary operators
    if (exprTyped.type === "binary") {
      const binExpr = expr as BinaryNode;
      return this.binaryGen.generate(binExpr.op, binExpr.left, binExpr.right, params);
    }

    // Call expressions
    if (exprTyped.type === "call") {
      return this.callGen.generate(expr as CallNode, params);
    }

    // Index access
    if (exprTyped.type === "index_access") {
      return this.indexAccessGen.generate(expr as IndexAccessNode, params);
    }

    // Member access
    if (exprTyped.type === "member_access") {
      return this.memberAccessGen.generate(expr as MemberAccessNode, params);
    }

    // Arrow functions
    if (exprTyped.type === "arrow_function") {
      const scopeVarsResult = this.ctx.symbolTable.getScopeVarsArraysForClosure();
      const scopeVarsTyped = scopeVarsResult as { names: string[]; types: string[] };
      let typeHints: { paramTypes?: string[]; returnType?: string } | undefined = undefined;
      const cbParamType = this.ctx.getExpectedCallbackParamType();
      const cbReturnType = this.ctx.getExpectedCallbackReturnType();
      if (cbParamType || cbReturnType) {
        const hintParamTypes: string[] | undefined = cbParamType ? [cbParamType] : undefined;
        typeHints = { paramTypes: hintParamTypes, returnType: cbReturnType || undefined };
      }
      const lambdaName = this.arrowFunctionGen.generateArrowFunction(
        expr as ArrowFunctionNode,
        params,
        typeHints,
        scopeVarsTyped.names,
        scopeVarsTyped.types,
      );

      // For inline lambdas with captures (e.g., arr.map(x => x + captured)),
      // allocate the env struct here so array methods can pass it as first arg.
      const closureInfoResult = this.arrowFunctionGen.getClosureInfoForLambda(lambdaName);
      if (closureInfoResult) {
        const closureInfo = closureInfoResult as {
          captures: { name: string; llvmType: string }[];
          envStructName: string;
        };
        const captures = closureInfo.captures;
        const envStructName = closureInfo.envStructName;
        const structSize = captures.length * 8;
        const envRawPtr = this.ctx.nextTemp();
        this.ctx.emit(`${envRawPtr} = call i8* @GC_malloc(i64 ${structSize})`);
        const envTypedPtr = this.ctx.nextTemp();
        this.ctx.emit(`${envTypedPtr} = bitcast i8* ${envRawPtr} to ${envStructName}*`);

        for (let i = 0; i < captures.length; i++) {
          const cap = captures[i] as { name: string; llvmType: string };
          const allocaReg = this.ctx.symbolTable.getAlloca(cap.name);
          if (!allocaReg) {
            this.ctx.emitError(
              `cannot capture '${cap.name}' in closure — module-level variables are not in scope. move the variable into a function or class.`,
            );
          }

          const valueReg = this.ctx.nextTemp();
          this.ctx.emit(`${valueReg} = load ${cap.llvmType}, ${cap.llvmType}* ${allocaReg}`);
          const fieldPtr = this.ctx.nextTemp();
          this.ctx.emit(
            `${fieldPtr} = getelementptr ${envStructName}, ${envStructName}* ${envTypedPtr}, i32 0, i32 ${i}`,
          );
          this.ctx.emit(`store ${cap.llvmType} ${valueReg}, ${cap.llvmType}* ${fieldPtr}`);
        }

        this.ctx.setLastInlineLambdaEnvPtr(envRawPtr);
      }

      return lambdaName;
    }

    // Conditional (ternary) expressions
    if (exprTyped.type === "conditional") {
      return this.conditionalGen.generate(expr as ConditionalExpressionNode, params);
    }

    // Template literals
    if (exprTyped.type === "template_literal") {
      return this.templateLiteralGen.generate(expr as TemplateLiteralNode, params);
    }

    // Method calls
    if (exprTyped.type === "method_call") {
      return this.methodCallGen.generate(expr as MethodCallNode, params);
    }

    // Await expressions
    if (exprTyped.type === "await") {
      const awaitExpr = expr as AwaitExpressionNode;
      const promiseReg = this.generate(awaitExpr.argument, params);
      const valueReg = this.ctx.nextTemp();
      this.ctx.emit(`${valueReg} = call i8* @__Promise_await(%Promise* ${promiseReg})`);
      this.ctx.setVariableType(valueReg, "i8*");
      this.ctx.setUsesPromises(true);
      return valueReg;
    }

    // Type assertions (expr as Type) - evaluate inner expression, type info tracked at declaration level.
    // When the inner expression is a variable, record its name so that
    // allocateDeclaredInterface can inherit the source variable's field order
    // (the asserted type may reorder fields relative to the object literal layout).
    if (exprTyped.type === "type_assertion") {
      const assertExpr = expr as TypeAssertionNode;
      const innerBase = assertExpr.expression as { type: string };
      if (innerBase.type === "variable") {
        const innerVar = assertExpr.expression as VariableNode;
        this.ctx.setLastTypeAssertionSourceVar(innerVar.name);
      } else {
        this.ctx.setLastTypeAssertionSourceVar(null);
      }
      return this.generate(assertExpr.expression, params);
    }

    // Index access assignment (arr[i] = value)
    if (exprTyped.type === "index_access_assignment") {
      return this.indexAccessGen.generateAssignment(expr as IndexAccessAssignmentNode, params);
    }

    // Hard error: unsupported expression types must not silently produce null pointers.
    // A null here would be UB that LLVM -O2 can exploit to prune unrelated code.
    this.ctx.emitError(
      "unsupported expression type: " + exprTyped.type,
      (expr as { loc?: { line: number; column: number } }).loc,
    );
  }

  /**
   * Get the arrow function generator (for accessing lifted functions)
   */
  getArrowFunctionGenerator(): ArrowFunctionExpressionGenerator {
    return this.arrowFunctionGen;
  }
}
