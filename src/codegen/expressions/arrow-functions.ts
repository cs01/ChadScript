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
import { FunctionNode, ArrowFunctionNode, BlockStatement } from "../../ast/types.js";
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
  // Struct-of-arrays for last lambda's closure info (avoids array-of-objects
  // access in getClosureInfoForLambda, which the native compiler can't handle).
  private lastCaptureNames: string[] = [];
  private lastCaptureTypes: string[] = [];
  private lastEnvStructName: string = "";

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
      );
      const typedResult = analyzeResult as { captures: CapturedVariable[]; envStructName: string };
      closureCaptures = typedResult.captures;
      closureEnvStructName = typedResult.envStructName;

      if (closureCaptures.length > 0) {
        this.envStructDefs.push({
          name: closureEnvStructName,
          fields: closureCaptures,
        });

        expr.captures = closureCaptures;
        closureInfo = typedResult;
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

    const liftedFunc: LiftedFunction = {
      name: funcName,
      params: funcParams,
      body: liftedBody,
      returnType: liftedReturnType,
      paramTypes: liftedParamTypes,
      closureInfo,
    };

    this.liftedFunctions.push(liftedFunc);

    // Store last lambda's capture info as flat arrays for the orchestrator.
    if (closureCaptures.length > 0) {
      const captNames: string[] = [];
      const captTypes: string[] = [];
      for (let ci = 0; ci < closureCaptures.length; ci++) {
        const cap = closureCaptures[ci] as { name: string; llvmType: string };
        captNames.push(cap.name);
        captTypes.push(cap.llvmType);
      }
      this.lastCaptureNames = captNames;
      this.lastCaptureTypes = captTypes;
      this.lastEnvStructName = closureEnvStructName;
    } else {
      this.lastCaptureNames = [];
      this.lastCaptureTypes = [];
      this.lastEnvStructName = "";
    }

    return funcName;
  }

  /**
   * Get LLVM IR type definitions for environment structs.
   */
  getEnvStructDefinitions(): string {
    let ir = "";
    for (let defIdx = 0; defIdx < this.envStructDefs.length; defIdx++) {
      const envDefRaw = this.envStructDefs[defIdx];
      const envDef = envDefRaw as { name: string; fields: CapturedVariable[] };
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
  getClosureInfoForLambda(lambdaName: string): ClosureInfo | undefined {
    let funcResult: LiftedFunction | null = null;
    for (let i = 0; i < this.liftedFunctions.length; i++) {
      const fRaw = this.liftedFunctions[i];
      const f = fRaw as { name: string };
      if (f.name === lambdaName) {
        funcResult = fRaw as LiftedFunction;
        break;
      }
    }
    if (funcResult) {
      // Field order must match the object literal in generateArrowFunction:
      // { name, params, body, returnType, paramTypes, closureInfo }
      const func = funcResult as {
        name: string;
        params: string[];
        body: BlockStatement;
        returnType: string;
        paramTypes: string[];
        closureInfo: ClosureInfo;
      };
      return func.closureInfo;
    }
    return undefined;
  }

  /**
   * Get the last generated lambda's capture info as flat arrays.
   * Uses struct-of-arrays pattern to avoid array-of-objects access
   * which crashes the native compiler during self-hosting.
   */
  getLastCaptureNames(): string[] {
    return this.lastCaptureNames;
  }

  getLastCaptureTypes(): string[] {
    return this.lastCaptureTypes;
  }

  getLastEnvStructName(): string {
    return this.lastEnvStructName;
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
    const bodyTyped = body as { type: string };
    if (bodyTyped.type === "object") {
      return "object";
    }
    if (
      bodyTyped.type === "string" ||
      bodyTyped.type === "string_literal" ||
      bodyTyped.type === "template_literal"
    ) {
      return "string";
    }
    if (bodyTyped.type === "binary") {
      const binExpr = body as { type: string; op: string; left: unknown; right: unknown };
      if (binExpr.op === "+") {
        const leftType = this.inferReturnTypeFromBody(binExpr.left as ArrowFunctionNode["body"]);
        const rightType = this.inferReturnTypeFromBody(binExpr.right as ArrowFunctionNode["body"]);
        if (leftType === "string" || rightType === "string") {
          return "string";
        }
      }
    }
    if (bodyTyped.type === "array") {
      return "array";
    }
    if (bodyTyped.type === "conditional") {
      const condTyped = body as {
        type: string;
        condition: unknown;
        consequent: unknown;
        alternate: unknown;
      };
      const consequent = condTyped.consequent;
      const alternate = condTyped.alternate;
      if (consequent) {
        const consequentTyped = consequent as { type: string };
        if (consequentTyped.type === "object") {
          return "object";
        }
        if (consequentTyped.type === "string_literal") {
          return "string";
        }
      }
      if (alternate) {
        const alternateTyped = alternate as { type: string };
        if (alternateTyped.type === "object") {
          return "object";
        }
      }
    }
    if (bodyTyped.type === "block") {
      const blockTyped = body as { type: string; statements: unknown[] };
      const blockStatements = blockTyped.statements;
      if (blockStatements) {
        for (let i = 0; i < blockStatements.length; i++) {
          const stmt = blockStatements[i];
          const stmtTyped = stmt as { type: string; value: unknown };
          if (stmtTyped.type === "return" && stmtTyped.value) {
            const returnValue = stmtTyped.value;
            const returnValueTyped = returnValue as { type: string };
            if (returnValueTyped.type === "object") {
              return "object";
            }
            if (
              returnValueTyped.type === "string" ||
              returnValueTyped.type === "string_literal" ||
              returnValueTyped.type === "template_literal"
            ) {
              return "string";
            }
          }
          if (stmtTyped.type === "if") {
            const ifStmt = stmt as {
              type: string;
              condition: unknown;
              thenBlock: unknown;
              elseBlock: unknown;
            };
            const thenBlock = ifStmt.thenBlock as { type: string; statements: unknown[] };
            const thenBlockStatements = thenBlock ? thenBlock.statements : null;
            if (thenBlockStatements) {
              for (let j = 0; j < thenBlockStatements.length; j++) {
                const innerStmt = thenBlockStatements[j];
                const innerStmtTyped = innerStmt as { type: string; value: unknown };
                if (innerStmtTyped.type === "return" && innerStmtTyped.value) {
                  const innerReturnValue = innerStmtTyped.value;
                  const innerReturnValueTyped = innerReturnValue as { type: string };
                  if (innerReturnValueTyped.type === "object") {
                    return "object";
                  }
                  if (
                    innerReturnValueTyped.type === "string" ||
                    innerReturnValueTyped.type === "string_literal" ||
                    innerReturnValueTyped.type === "template_literal"
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
