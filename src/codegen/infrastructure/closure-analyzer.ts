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

import type { Expression, BlockStatement, Statement, ObjectProperty } from '../../ast/types.js';

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

    const bodyTyped = body as { type: string };
    if (bodyTyped.type === 'block') {
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
    const stmtTyped = stmt as { type: string };

    switch (stmtTyped.type) {
      case 'variable_declaration': {
        const s = stmt as { type: string; name: string; value: Expression | null };
        this.declaredVars.add(s.name);
        if (s.value) {
          this.walkExpression(s.value);
        }
        break;
      }

      case 'assignment': {
        const s = stmt as { type: string; target: Expression; value: Expression };
        this.walkExpression(s.target);
        this.walkExpression(s.value);
        break;
      }

      case 'expression_statement': {
        const s = stmt as { type: string; expression: Expression };
        this.walkExpression(s.expression);
        break;
      }

      case 'return': {
        const s = stmt as { type: string; value: Expression | null };
        if (s.value) {
          this.walkExpression(s.value);
        }
        break;
      }

      case 'if': {
        const s = stmt as { type: string; condition: Expression; consequent: BlockStatement; alternate: Statement | BlockStatement | null };
        this.walkExpression(s.condition);
        if (s.consequent) {
          this.walkBlock(s.consequent);
        }
        if (s.alternate) {
          const alt = s.alternate as { type: string };
          if (alt.type === 'if') {
            this.walkStatement(s.alternate as Statement);
          } else {
            this.walkBlock(s.alternate as BlockStatement);
          }
        }
        break;
      }

      case 'while': {
        const s = stmt as { type: string; condition: Expression; body: BlockStatement };
        this.walkExpression(s.condition);
        this.walkBlock(s.body);
        break;
      }

      case 'for': {
        const s = stmt as { type: string; init: Statement | null; condition: Expression | null; update: Statement | Expression | null; body: BlockStatement };
        if (s.init) this.walkStatement(s.init);
        if (s.condition) this.walkExpression(s.condition);
        if (s.update) {
          const upd = s.update as { type: string };
          if (upd.type) {
            this.walkStatement(s.update as Statement);
          } else {
            this.walkExpression(s.update as Expression);
          }
        }
        this.walkBlock(s.body);
        break;
      }

      case 'for_of': {
        const s = stmt as { type: string; variable: string; iterable: Expression; body: BlockStatement };
        this.declaredVars.add(s.variable);
        this.walkExpression(s.iterable);
        this.walkBlock(s.body);
        break;
      }

      case 'try': {
        const s = stmt as { type: string; body: BlockStatement; handler: { param: string | null; body: BlockStatement } | null; finalizer: BlockStatement | null };
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
  }

  private walkExpression(expr: Expression): void {
    const exprTyped = expr as { type: string };

    switch (exprTyped.type) {
      case 'variable': {
        const e = expr as { type: string; name: string };
        this.referencedVars.add(e.name);
        break;
      }

      case 'binary': {
        const e = expr as { type: string; left: Expression; right: Expression };
        this.walkExpression(e.left);
        this.walkExpression(e.right);
        break;
      }

      case 'unary': {
        const e = expr as { type: string; operand: Expression };
        this.walkExpression(e.operand);
        break;
      }

      case 'call': {
        const e = expr as { type: string; callee: Expression; args: Expression[] };
        const calleeTyped = e.callee as { type: string; name: string };
        if (calleeTyped.type === 'variable') {
          this.referencedVars.add(calleeTyped.name);
        } else {
          this.walkExpression(e.callee);
        }
        for (const arg of e.args) {
          this.walkExpression(arg);
        }
        break;
      }

      case 'method_call': {
        const e = expr as { type: string; object: Expression; args: Expression[] };
        this.walkExpression(e.object);
        for (const arg of e.args) {
          this.walkExpression(arg);
        }
        break;
      }

      case 'member_access': {
        const e = expr as { type: string; object: Expression };
        this.walkExpression(e.object);
        break;
      }

      case 'index_access': {
        const e = expr as { type: string; object: Expression; index: Expression };
        this.walkExpression(e.object);
        this.walkExpression(e.index);
        break;
      }

      case 'array': {
        const e = expr as { type: string; elements: Expression[] };
        for (const el of e.elements) {
          this.walkExpression(el);
        }
        break;
      }

      case 'object': {
        const e = expr as { type: string; properties: ObjectProperty[] };
        for (let i = 0; i < e.properties.length; i++) {
          const prop = e.properties[i] as ObjectProperty;
          this.walkExpression(prop.value);
        }
        break;
      }

      case 'template_literal': {
        const e = expr as { type: string; parts: (string | Expression)[] };
        for (const part of e.parts) {
          if (typeof part !== 'string') {
            this.walkExpression(part);
          }
        }
        break;
      }

      case 'arrow_function': {
        const e = expr as { type: string; params: string[]; body: Expression | BlockStatement };
        const nestedDeclared = new Set(this.declaredVars);
        for (const p of e.params) {
          this.declaredVars.add(p);
        }
        const bodyTyped = e.body as { type: string };
        if (bodyTyped.type === 'block') {
          this.walkBlock(e.body as BlockStatement);
        } else {
          this.walkExpression(e.body as Expression);
        }
        this.declaredVars = nestedDeclared;
        break;
      }

      case 'conditional': {
        const e = expr as { type: string; condition: Expression; consequent: Expression; alternate: Expression };
        this.walkExpression(e.condition);
        this.walkExpression(e.consequent);
        this.walkExpression(e.alternate);
        break;
      }

      case 'await': {
        const e = expr as { type: string; argument: Expression };
        this.walkExpression(e.argument);
        break;
      }

      case 'new': {
        const e = expr as { type: string; args: Expression[] };
        for (const arg of e.args) {
          this.walkExpression(arg);
        }
        break;
      }

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
