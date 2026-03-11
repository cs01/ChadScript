/**
 * Arrow Function Expression Generator
 *
 * Handles arrow function (lambda) expressions using lambda lifting:
 * Converts inline arrow functions to top-level functions.
 *
 * For closures that capture outer variables:
 * 1. Analyzes the arrow function body to find free variables
 * 2. Generates an environment struct containing captured variable pointers
 * 3. Adds an environment pointer parameter to the lifted function
 * 4. Generates code to load captured variables from the environment
 */

import { BaseGenerator } from "../infrastructure/base-generator.js";
import {
  FunctionNode,
  ArrowFunctionNode,
  BlockStatement,
  FunctionParameter,
  SourceLocation,
  BinaryNode,
  ReturnStatement,
  IfStatement,
  Expression,
  ConditionalExpressionNode,
} from "../../ast/types.js";
import {
  ClosureAnalyzer,
  CapturedVariable,
  ClosureInfo,
} from "../infrastructure/closure-analyzer.js";

export interface LiftedFunction extends FunctionNode {
  closureInfo?: ClosureInfo;
}

interface EnvStructDef {
  name: string;
  fields: CapturedVariable[];
}

interface ArrowFunctionTypeHints {
  paramTypes?: string[];
  returnType?: string;
}

export class ArrowFunctionExpressionGenerator extends BaseGenerator {
  private anonFuncCounter = 0;
  private liftedFunctions: LiftedFunction[] = [];
  private envStructDefs: EnvStructDef[] = [];
  private closureAnalyzer: ClosureAnalyzer;

  constructor() {
    super();
    this.closureAnalyzer = new ClosureAnalyzer();
  }

  /**
   * Generate code for an arrow function expression.
   * Uses lambda lifting: converts inline function to top-level function.
   *
   * @param expr - The arrow function expression
   * @param params - Function parameters in scope
   * @param typeHints - Optional type hints for parameters and return type
   * @param scopeVarNames - Names of variables available in outer scope for closure capture
   * @param scopeVarTypes - LLVM types corresponding to scopeVarNames
   * @returns Function name that can be referenced
   */
  generateArrowFunction(
    expr: ArrowFunctionNode,
    _params: string[],
    typeHints?: ArrowFunctionTypeHints,
    scopeVarNames?: string[],
    scopeVarTypes?: string[],
    scopeVarInterfaceTypes?: string[],
  ): string {
    const funcName = `__lambda_${this.anonFuncCounter++}`;

    let funcParams = expr.params;
    const hasTypeHints = typeHints !== undefined && typeHints !== null;
    let hintParamTypes: string[] | undefined = undefined;
    if (hasTypeHints) {
      hintParamTypes = typeHints!.paramTypes;
    }
    const hasParamTypes = hintParamTypes !== undefined && hintParamTypes !== null;
    if (hasParamTypes) {
      const ptLen = hintParamTypes!.length;
      if (ptLen > funcParams.length) {
        funcParams = funcParams.slice(0);
        for (let i = funcParams.length; i < ptLen; i++) {
          funcParams.push(`__unused_${i}`);
        }
      }
    }

    if (!hasParamTypes && funcParams.length > 0) {
      const inferredTypes = this.inferParamTypesFromBody(funcParams, expr.body);
      if (inferredTypes.length > 0) {
        typeHints = { paramTypes: inferredTypes, returnType: undefined };
      }
    }

    const hasReturnType =
      typeHints !== undefined &&
      typeHints !== null &&
      typeHints.returnType !== undefined &&
      typeHints.returnType !== null;
    if (!hasReturnType) {
      const inferredReturnType = this.inferReturnTypeFromBody(expr.body);
      if (inferredReturnType) {
        if (typeHints) {
          typeHints = { paramTypes: typeHints.paramTypes, returnType: inferredReturnType };
        } else {
          typeHints = { paramTypes: undefined, returnType: inferredReturnType };
        }
      }
    }

    let closureInfo: ClosureInfo | undefined;
    let closureCaptures: CapturedVariable[] = [];
    let closureEnvStructName: string = "";

    if (scopeVarNames && scopeVarTypes) {
      const closureAnalyzer = new ClosureAnalyzer();
      const analyzeResult = closureAnalyzer.analyze(
        funcParams,
        expr.body,
        scopeVarNames,
        scopeVarTypes,
        funcName,
        scopeVarInterfaceTypes,
      );
      closureCaptures = analyzeResult.captures;
      closureEnvStructName = analyzeResult.envStructName;

      if (closureCaptures.length > 0) {
        this.envStructDefs.push({
          name: closureEnvStructName,
          fields: closureCaptures,
        });

        expr.captures = closureCaptures;
        closureInfo = analyzeResult;
      }
    }

    let liftedParamTypes: string[] | undefined = undefined;
    let liftedReturnType: string | undefined = undefined;
    if (typeHints) {
      liftedParamTypes = typeHints.paramTypes;
      liftedReturnType = typeHints.returnType;
    }

    let liftedBody: BlockStatement;
    if (expr.body.type === "block") {
      liftedBody = expr.body as BlockStatement;
    } else {
      liftedBody = {
        type: "block",
        statements: [{ type: "return", value: expr.body }],
      } as BlockStatement;
    }

    // All FunctionNode fields must be present so the native compiler allocates
    // the full struct size — closureInfo is the 11th field (after declare).
    const liftedFunc: LiftedFunction = {
      name: funcName,
      params: funcParams,
      body: liftedBody,
      returnType: liftedReturnType,
      paramTypes: liftedParamTypes,
      async: undefined,
      parameters: undefined,
      loc: undefined,
      declare: false,
      typeParameters: undefined,
      closureInfo,
    };

    this.liftedFunctions.push(liftedFunc);

    return funcName;
  }

  /**
   * Get LLVM IR type definitions for environment structs.
   */
  getEnvStructDefinitions(): string {
    let ir = "";
    for (let defIdx = 0; defIdx < this.envStructDefs.length; defIdx++) {
      const envDefRaw = this.envStructDefs[defIdx];
      const envDef = envDefRaw as EnvStructDef;
      const fieldTypesArr: string[] = [];
      for (let i = 0; i < envDef.fields.length; i++) {
        const envField = envDef.fields[i] as { name: string; llvmType: string };
        fieldTypesArr.push(envField.llvmType + "*");
      }
      const fieldTypes = fieldTypesArr.join(", ");
      ir += `${envDef.name} = type { ${fieldTypes} }` + "\n";
    }
    return ir;
  }

  /**
   * Get all lifted functions that need to be added at the top level.
   */
  getLiftedFunctions(): LiftedFunction[] {
    return this.liftedFunctions;
  }

  /**
   * Get closure info for a specific lambda by name.
   */
  getLiftedFunctionByName(name: string): LiftedFunction | undefined {
    for (let i = 0; i < this.liftedFunctions.length; i++) {
      const f = this.liftedFunctions[i] as LiftedFunction;
      if (f.name === name) return f;
    }
    return undefined;
  }

  getClosureInfoForLambda(lambdaName: string): ClosureInfo | undefined {
    let funcResult: LiftedFunction | null = null;
    for (let i = 0; i < this.liftedFunctions.length; i++) {
      const fRaw = this.liftedFunctions[i];
      const f = fRaw as LiftedFunction;
      if (f.name === lambdaName) {
        funcResult = fRaw as LiftedFunction;
        break;
      }
    }
    if (funcResult) {
      // Type assertion must include ALL fields from FunctionNode + closureInfo
      // in exact struct order. LiftedFunction extends FunctionNode (10 fields),
      // so closureInfo is at index 10. Omitting middle fields causes GEP to
      // read the wrong offset in native code.
      const func = funcResult as {
        name: string;
        params: string[];
        body: BlockStatement;
        returnType: string;
        paramTypes: string[];
        async: boolean;
        parameters: FunctionParameter[];
        loc: SourceLocation;
        declare: boolean;
        typeParameters: string[];
        closureInfo: ClosureInfo;
      };
      return func.closureInfo;
    }
    return undefined;
  }

  /**
   * Clear lifted functions (used when starting a new function).
   */
  clearLiftedFunctions(): void {
    this.liftedFunctions = [];
  }

  /**
   * Reset the anonymous function counter.
   */
  resetCounter(): void {
    this.anonFuncCounter = 0;
    this.envStructDefs = [];
  }

  private inferParamTypesFromBody(_params: string[], _body: ArrowFunctionNode["body"]): string[] {
    return [];
  }

  private inferReturnTypeFromBody(body: ArrowFunctionNode["body"]): string | null {
    if (body.type === "object") {
      return "object";
    }
    if (
      body.type === "string" ||
      (body.type as string) === "string_literal" ||
      body.type === "template_literal"
    ) {
      return "string";
    }
    if (body.type === "binary") {
      const binExpr = body as BinaryNode;
      if (binExpr.op === "+") {
        const leftType = this.inferReturnTypeFromBody(binExpr.left as ArrowFunctionNode["body"]);
        const rightType = this.inferReturnTypeFromBody(binExpr.right as ArrowFunctionNode["body"]);
        if (leftType === "string" || rightType === "string") {
          return "string";
        }
      }
    }
    if (body.type === "array") {
      return "array";
    }
    if (body.type === "conditional") {
      const cond = body as ConditionalExpressionNode;
      if (cond.consequent.type === "object") {
        return "object";
      }
      if ((cond.consequent.type as string) === "string_literal") {
        return "string";
      }
      if (cond.alternate.type === "object") {
        return "object";
      }
    }
    if (body.type === "block") {
      const blockTyped = body as BlockStatement;
      const blockStatements = blockTyped.statements;
      if (blockStatements) {
        for (let i = 0; i < blockStatements.length; i++) {
          const stmt = blockStatements[i];
          if (stmt.type === "return") {
            const stmtTyped = stmt as ReturnStatement;
            if (stmtTyped.value) {
              if (stmtTyped.value.type === "object") {
                return "object";
              }
              if (
                stmtTyped.value.type === "string" ||
                (stmtTyped.value.type as string) === "string_literal" ||
                stmtTyped.value.type === "template_literal"
              ) {
                return "string";
              }
              if (stmtTyped.value.type === "binary") {
                const retBin = stmtTyped.value as BinaryNode;
                if (retBin.op === "+") {
                  const lt = this.inferReturnTypeFromBody(retBin.left as ArrowFunctionNode["body"]);
                  const rt = this.inferReturnTypeFromBody(retBin.right as ArrowFunctionNode["body"]);
                  if (lt === "string" || rt === "string") return "string";
                }
              }
            }
          }
          if (stmt.type === "if") {
            const ifStmt = stmt as IfStatement;
            const thenBlock = ifStmt.thenBlock;
            const thenBlockStatements = thenBlock ? thenBlock.statements : null;
            if (thenBlockStatements) {
              for (let j = 0; j < thenBlockStatements.length; j++) {
                const innerStmtTyped = thenBlockStatements[j] as ReturnStatement;
                if (innerStmtTyped.type === "return" && innerStmtTyped.value) {
                  if (innerStmtTyped.value.type === "object") {
                    return "object";
                  }
                  if (
                    innerStmtTyped.value.type === "string" ||
                    (innerStmtTyped.value.type as string) === "string_literal" ||
                    innerStmtTyped.value.type === "template_literal"
                  ) {
                    return "string";
                  }
                }
              }
            }
          }
        }
      }
    }
    return null;
  }
}
