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
import { Expression, FunctionNode, BlockStatement, ArrowFunctionNode } from '../../ast/types.js';
import { ClosureAnalyzer, CapturedVariable, ClosureInfo } from '../infrastructure/closure-analyzer.js';

export interface LiftedFunction extends FunctionNode {
  closureInfo?: ClosureInfo;
}

export interface EnvStructDef {
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
  private closureAnalyzer: ClosureAnalyzer = new ClosureAnalyzer();

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
    params: string[],
    typeHints?: ArrowFunctionTypeHints,
    scopeVarNames?: string[],
    scopeVarTypes?: string[]
  ): string {
    const funcName = `__lambda_${this.anonFuncCounter++}`;

    let funcParams = expr.params;
    if (typeHints?.paramTypes && typeHints.paramTypes.length > funcParams.length) {
      funcParams = funcParams.slice(0);
      for (let i = funcParams.length; i < typeHints.paramTypes.length; i++) {
        funcParams.push(`__unused_${i}`);
      }
    }

    let closureInfo: ClosureInfo | undefined;
    let closureCaptures: CapturedVariable[] = [];
    let closureEnvStructName: string = '';

    if (scopeVarNames && scopeVarTypes) {
      const analyzeResult = this.closureAnalyzer.analyze(
        funcParams,
        expr.body,
        scopeVarNames,
        scopeVarTypes,
        funcName
      );
      const typedResult = analyzeResult as { captures: CapturedVariable[]; envStructName: string };
      closureCaptures = typedResult.captures;
      closureEnvStructName = typedResult.envStructName;

      if (closureCaptures.length > 0) {
        this.envStructDefs.push({
          name: closureEnvStructName,
          fields: closureCaptures
        });

        expr.captures = closureCaptures;
        closureInfo = typedResult;
      }
    }

    const liftedFunc: LiftedFunction = {
      name: funcName,
      params: funcParams,
      body: expr.body.type === 'block' ? expr.body : {
        type: 'block',
        statements: [{ type: 'return', value: expr.body }]
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
    for (let defIdx = 0; defIdx < this.envStructDefs.length; defIdx++) {
      const envDefRaw = this.envStructDefs[defIdx];
      const envDef = envDefRaw as { name: string; fields: CapturedVariable[] };
      const fieldTypesArr: string[] = [];
      for (let i = 0; i < envDef.fields.length; i++) {
        const envField = envDef.fields[i] as { name: string; llvmType: string };
        fieldTypesArr.push(envField.llvmType + '*');
      }
      const fieldTypes = fieldTypesArr.join(', ');
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
    let funcResult: LiftedFunction | null = null;
    for (let i = 0; i < this.liftedFunctions.length; i++) {
      const fRaw = this.liftedFunctions[i];
      const f = fRaw as { name: string; closureInfo: ClosureInfo };
      if (f.name === lambdaName) {
        funcResult = fRaw as LiftedFunction;
        break;
      }
    }
    if (funcResult) {
      const func = funcResult as { closureInfo: ClosureInfo };
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
}
