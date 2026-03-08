import { Expression, ArrowFunctionNode, VariableNode } from "../../ast/types.js";
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
import {
  dispatchPrimitiveLiteral,
  dispatchComplexLiteral,
  dispatchConstructorLiteral,
  dispatchOperatorExpression,
  dispatchAccessExpression,
  dispatchHighLevelExpression,
  ExpressionDispatchContext,
} from "./expression-dispatch.js";

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

  private dispatchCtx: ExpressionDispatchContext | null = null;

  private getDispatchCtx(): ExpressionDispatchContext {
    if (!this.dispatchCtx) {
      this.dispatchCtx = {
        literalGen: this.literalGen,
        variableGen: this.variableGen,
        binaryGen: this.binaryGen,
        unaryGen: this.unaryGen,
        callGen: this.callGen,
        indexAccessGen: this.indexAccessGen,
        memberAccessGen: this.memberAccessGen,
        conditionalGen: this.conditionalGen,
        templateLiteralGen: this.templateLiteralGen,
        methodCallGen: this.methodCallGen,
        setVariableType: (name: string, type: string) => this.ctx.setVariableType(name, type),
        setUsesPromises: (value: boolean) => this.ctx.setUsesPromises(value),
        setLastTypeAssertionSourceVar: (name: string | null) =>
          this.ctx.setLastTypeAssertionSourceVar(name),
        nextTemp: () => this.ctx.nextTemp(),
        emit: (instruction: string) => this.ctx.emit(instruction),
        generateExpression: (expr: Expression, params: string[]) => this.generate(expr, params),
      };
    }
    return this.dispatchCtx;
  }

  generate(expr: Expression, params: string[]): string {
    if (!expr.type || expr.type.length === 0) {
      this.ctx.emitError(
        "expression has empty type — this likely indicates a parser bug",
        (expr as { loc?: { line: number; column: number } }).loc,
      );
    }

    const dctx = this.getDispatchCtx();

    const r1 = dispatchPrimitiveLiteral(dctx, expr, params);
    if (r1 !== null) return r1;

    const r2 = dispatchComplexLiteral(dctx, expr, params);
    if (r2 !== null) return r2;

    const r3 = dispatchConstructorLiteral(dctx, expr, params);
    if (r3 !== null) return r3;

    const r4 = dispatchOperatorExpression(dctx, expr, params);
    if (r4 !== null) return r4;

    if (expr.type === "arrow_function") {
      return this.generateArrowFunctionExpression(expr as ArrowFunctionNode, params);
    }

    const r5 = dispatchAccessExpression(dctx, expr, params);
    if (r5 !== null) return r5;

    const r6 = dispatchHighLevelExpression(dctx, expr, params);
    if (r6 !== null) return r6;

    this.ctx.emitError(
      "unsupported expression type: " + expr.type,
      (expr as { loc?: { line: number; column: number } }).loc,
    );
  }

  private generateArrowFunctionExpression(expr: ArrowFunctionNode, params: string[]): string {
    const scopeVarsResult = this.ctx.symbolTable.getScopeVarsArraysForClosure();
    const scopeVarsTyped = scopeVarsResult as {
      names: string[];
      types: string[];
      interfaceTypes: string[];
    };
    let typeHints: { paramTypes?: string[]; returnType?: string } | undefined = undefined;
    const cbParamType = this.ctx.getExpectedCallbackParamType();
    const cbReturnType = this.ctx.getExpectedCallbackReturnType();
    if (cbParamType || cbReturnType) {
      const hintParamTypes: string[] | undefined = cbParamType ? [cbParamType] : undefined;
      typeHints = { paramTypes: hintParamTypes, returnType: cbReturnType || undefined };
    }
    const lambdaName = this.arrowFunctionGen.generateArrowFunction(
      expr,
      params,
      typeHints,
      scopeVarsTyped.names,
      scopeVarsTyped.types,
      scopeVarsTyped.interfaceTypes,
    );

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

  /**
   * Get the arrow function generator (for accessing lifted functions)
   */
  getArrowFunctionGenerator(): ArrowFunctionExpressionGenerator {
    return this.arrowFunctionGen;
  }
}
