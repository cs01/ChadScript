/**
 * Closure Analyzer
 *
 * Identifies free variables in arrow functions that need to be captured
 * in a closure environment. A "free variable" is one that:
 * - Is referenced inside the arrow function body
 * - Is NOT a parameter of the arrow function
 * - Is NOT declared locally inside the arrow function
 *
 * These variables must be captured in an environment struct and passed
 * to the lifted lambda function.
 */

import type { Expression, BlockStatement, Statement } from '../../ast/types.js';

export interface CapturedVariable {
  name: string;
  llvmType: string;
}

export interface ClosureInfo {
  captures: CapturedVariable[];
  envStructName: string;
}

export class ClosureAnalyzer {
  private declaredVars: Set<string> = new Set();
  private referencedVars: Set<string> = new Set();

  /**
   * Analyze an arrow function and return information about captured variables.
   *
   * @param params - The arrow function's parameter names
   * @param body - The arrow function's body (expression or block)
   * @param scopeVars - Variables available in the outer scope with their types
   * @param lambdaName - The lifted function name (for generating env struct name)
   */
  analyze(
    params: string[],
    body: Expression | BlockStatement,
    scopeVars: Map<string, string>,
    lambdaName: string
  ): ClosureInfo {
    this.declaredVars.clear();
    this.referencedVars.clear();

    for (const param of params) {
      this.declaredVars.add(param);
    }

    if ((body as any).type === 'block') {
      this.walkBlock(body as BlockStatement);
    } else {
      this.walkExpression(body as Expression);
    }

    const captures: CapturedVariable[] = [];
    for (const varName of this.referencedVars) {
      if (!this.declaredVars.has(varName) && scopeVars.has(varName)) {
        captures.push({
          name: varName,
          llvmType: scopeVars.get(varName)!
        });
      }
    }

    return {
      captures,
      envStructName: `%__env_${lambdaName}`
    };
  }

  private walkBlock(block: BlockStatement): void {
    for (const stmt of block.statements) {
      this.walkStatement(stmt);
    }
  }

  private walkStatement(stmt: Statement): void {
    const s = stmt as any;

    switch (s.type) {
      case 'variable_declaration':
        this.declaredVars.add(s.name);
        if (s.value) {
          this.walkExpression(s.value);
        }
        break;

      case 'assignment':
        this.walkExpression(s.target);
        this.walkExpression(s.value);
        break;

      case 'expression_statement':
        this.walkExpression(s.expression);
        break;

      case 'return':
        if (s.value) {
          this.walkExpression(s.value);
        }
        break;

      case 'if':
        this.walkExpression(s.condition);
        this.walkBlock(s.consequent);
        if (s.alternate) {
          if (s.alternate.type === 'if') {
            this.walkStatement(s.alternate);
          } else {
            this.walkBlock(s.alternate);
          }
        }
        break;

      case 'while':
        this.walkExpression(s.condition);
        this.walkBlock(s.body);
        break;

      case 'for':
        if (s.init) this.walkStatement(s.init);
        if (s.condition) this.walkExpression(s.condition);
        if (s.update) {
          if (s.update.type) {
            this.walkStatement(s.update);
          } else {
            this.walkExpression(s.update);
          }
        }
        this.walkBlock(s.body);
        break;

      case 'for_of':
        this.declaredVars.add(s.variable);
        this.walkExpression(s.iterable);
        this.walkBlock(s.body);
        break;

      case 'try':
        this.walkBlock(s.body);
        if (s.handler) {
          if (s.handler.param) {
            this.declaredVars.add(s.handler.param);
          }
          this.walkBlock(s.handler.body);
        }
        if (s.finalizer) {
          this.walkBlock(s.finalizer);
        }
        break;
    }
  }

  private walkExpression(expr: Expression): void {
    const e = expr as any;

    switch (e.type) {
      case 'variable':
        this.referencedVars.add(e.name);
        break;

      case 'binary':
        this.walkExpression(e.left);
        this.walkExpression(e.right);
        break;

      case 'unary':
        this.walkExpression(e.operand);
        break;

      case 'call':
        if (e.callee.type === 'variable') {
          this.referencedVars.add(e.callee.name);
        } else {
          this.walkExpression(e.callee);
        }
        for (const arg of e.args) {
          this.walkExpression(arg);
        }
        break;

      case 'method_call':
        this.walkExpression(e.object);
        for (const arg of e.args) {
          this.walkExpression(arg);
        }
        break;

      case 'member_access':
        this.walkExpression(e.object);
        break;

      case 'index_access':
        this.walkExpression(e.object);
        this.walkExpression(e.index);
        break;

      case 'array':
        for (const el of e.elements) {
          this.walkExpression(el);
        }
        break;

      case 'object':
        for (const prop of e.properties) {
          this.walkExpression(prop.value);
        }
        break;

      case 'template_literal':
        for (const part of e.parts) {
          if (typeof part !== 'string') {
            this.walkExpression(part);
          }
        }
        break;

      case 'arrow_function':
        const nestedParams = new Set(e.params);
        const nestedDeclared = new Set(this.declaredVars);
        for (const p of e.params) {
          this.declaredVars.add(p);
        }
        if (e.body.type === 'block') {
          this.walkBlock(e.body);
        } else {
          this.walkExpression(e.body);
        }
        this.declaredVars = nestedDeclared;
        break;

      case 'conditional':
        this.walkExpression(e.condition);
        this.walkExpression(e.consequent);
        this.walkExpression(e.alternate);
        break;

      case 'await':
        this.walkExpression(e.argument);
        break;

      case 'new':
        for (const arg of e.args) {
          this.walkExpression(arg);
        }
        break;

      case 'this':
      case 'super':
      case 'number':
      case 'string':
      case 'boolean':
      case 'regex':
        break;
    }
  }
}
