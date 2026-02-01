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

import { BaseGenerator } from '../infrastructure/base-generator.js';
import type { Expression, FunctionNode, BlockStatement, ArrowFunctionNode } from '../../ast/types.js';
import { ClosureAnalyzer, CapturedVariable, ClosureInfo } from '../infrastructure/closure-analyzer.js';

export interface LiftedFunction extends FunctionNode {
  closureInfo?: ClosureInfo;
}

export interface EnvStructDef {
  name: string;
  fields: CapturedVariable[];
}

export class ArrowFunctionExpressionGenerator extends BaseGenerator {
  private anonFuncCounter = 0;
  private liftedFunctions: LiftedFunction[] = [];
  private envStructDefs: EnvStructDef[] = [];
  private closureAnalyzer: ClosureAnalyzer = new ClosureAnalyzer();

  /**
   * Generate code for an arrow function expression.
   * Uses lambda lifting: converts inline function to top-level function.
   *
   * @param expr - The arrow function expression
   * @param params - Function parameters in scope
   * @param typeHints - Optional type hints for parameters and return type
   * @param scopeVars - Variables available in outer scope for closure capture
   * @returns Function name that can be referenced
   */
  generateArrowFunction(
    expr: ArrowFunctionNode,
    params: string[],
    typeHints?: { paramTypes?: string[], returnType?: string },
    scopeVars?: Map<string, string>
  ): string {
    const arrowFunc = expr;
    const funcName = `__lambda_${this.anonFuncCounter++}`;

    let funcParams = arrowFunc.params;
    if (typeHints?.paramTypes && typeHints.paramTypes.length > funcParams.length) {
      funcParams = [...funcParams];
      for (let i = funcParams.length; i < typeHints.paramTypes.length; i++) {
        funcParams.push(`__unused_${i}`);
      }
    }

    let closureInfo: ClosureInfo | undefined;

    if (scopeVars && scopeVars.size > 0) {
      closureInfo = this.closureAnalyzer.analyze(
        funcParams,
        arrowFunc.body,
        scopeVars,
        funcName
      );

      if (closureInfo.captures.length > 0) {
        this.envStructDefs.push({
          name: closureInfo.envStructName,
          fields: closureInfo.captures
        });

        arrowFunc.captures = closureInfo.captures;
      } else {
        closureInfo = undefined;
      }
    }

    const liftedFunc: LiftedFunction = {
      name: funcName,
      params: funcParams,
      body: arrowFunc.body.type === 'block' ? arrowFunc.body : {
        type: 'block',
        statements: [{ type: 'return', value: arrowFunc.body }]
      },
      paramTypes: typeHints?.paramTypes,
      returnType: typeHints?.returnType,
      closureInfo
    };

    this.liftedFunctions.push(liftedFunc);

    return funcName;
  }

  /**
   * Get LLVM IR type definitions for environment structs.
   */
  getEnvStructDefinitions(): string {
    let ir = '';
    for (const envDef of this.envStructDefs) {
      const fieldTypes = envDef.fields.map(f => f.llvmType + '*').join(', ');
      ir += `${envDef.name} = type { ${fieldTypes} }\n`;
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
   * Get all environment struct definitions.
   */
  getEnvStructDefs(): EnvStructDef[] {
    return this.envStructDefs;
  }

  /**
   * Get closure info for a specific lambda by name.
   */
  getClosureInfoForLambda(lambdaName: string): ClosureInfo | undefined {
    const func = this.liftedFunctions.find(f => f.name === lambdaName);
    return func?.closureInfo;
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
}
