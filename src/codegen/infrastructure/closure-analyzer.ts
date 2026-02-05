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

import type { Expression, BlockStatement, Statement, ObjectProperty, TryStatement } from '../../ast/types.js';

interface TypedNode {
  type: string;
}

interface VarDeclNode {
  type: string;
  name: string;
  value: Expression | null;
}

interface AssignmentNode {
  type: string;
  target: Expression;
  value: Expression;
}

interface ExprStmtNode {
  type: string;
  expression: Expression;
}

interface ReturnNode {
  type: string;
  value: Expression | null;
}

interface IfNode {
  type: string;
  condition: Expression;
  consequent: BlockStatement;
  alternate: Statement | BlockStatement | null;
}

interface WhileNode {
  type: string;
  condition: Expression;
  body: BlockStatement;
}

interface ForNode {
  type: string;
  init: Statement | null;
  condition: Expression | null;
  update: Statement | Expression | null;
  body: BlockStatement;
}

interface ForOfNode {
  type: string;
  variable: string;
  iterable: Expression;
  body: BlockStatement;
}

interface CatchHandler {
  param: string | null;
  body: BlockStatement;
}

interface TryNode {
  type: string;
  tryBlock: BlockStatement;
  catchClause: CatchHandler | null;
  finallyBlock: BlockStatement | null;
}

interface VariableExpr {
  type: string;
  name: string;
}

interface BinaryExpr {
  type: string;
  left: Expression;
  right: Expression;
}

interface UnaryExpr {
  type: string;
  operand: Expression;
}

interface CallExpr {
  type: string;
  name: string;
  args: Expression[];
}

interface MethodCallExpr {
  type: string;
  object: Expression;
  args: Expression[];
}

interface MemberAccessExpr {
  type: string;
  object: Expression;
}

interface IndexAccessExpr {
  type: string;
  object: Expression;
  index: Expression;
}

interface ArrayExpr {
  type: string;
  elements: Expression[];
}

interface ObjectExpr {
  type: string;
  properties: ObjectProperty[];
}

interface TemplateLiteralExpr {
  type: string;
  parts: (string | Expression)[];
}

interface ArrowFunctionExpr {
  type: string;
  params: string[];
  body: Expression | BlockStatement;
}

interface ConditionalExpr {
  type: string;
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
}

interface AwaitExpr {
  type: string;
  argument: Expression;
}

interface NewExpr {
  type: string;
  args: Expression[];
}

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
  private scopeVarNames: string[] = [];
  private scopeVarTypes: string[] = [];

  /**
   * Analyze an arrow function and return information about captured variables.
   *
   * @param params - The arrow function's parameter names
   * @param body - The arrow function's body (expression or block)
   * @param scopeVarNamesIn - Names of variables available in the outer scope
   * @param scopeVarTypesIn - LLVM types of variables available in the outer scope
   * @param lambdaName - The lifted function name (for generating env struct name)
   */
  analyze(
    params: string[],
    body: Expression | BlockStatement,
    scopeVarNamesIn: string[],
    scopeVarTypesIn: string[],
    lambdaName: string
  ): ClosureInfo {
    this.declaredVars = new Set();
    this.referencedVars = new Set();

    this.scopeVarNames = [];
    this.scopeVarTypes = [];
    for (let i = 0; i < scopeVarNamesIn.length; i++) {
      this.scopeVarNames.push(scopeVarNamesIn[i]);
      this.scopeVarTypes.push(scopeVarTypesIn[i]);
    }

    for (const param of params) {
      this.declaredVars.add(param);
    }

    const bodyTyped = body as TypedNode;
    if (bodyTyped.type === 'block') {
      this.walkBlock(body as BlockStatement);
    } else {
      this.walkExpression(body as Expression);
    }

    const captures: CapturedVariable[] = [];
    for (const varName of this.referencedVars) {
      if (!this.declaredVars.has(varName) && this.hasScopeVar(varName)) {
        captures.push({
          name: varName,
          llvmType: this.getScopeVarType(varName)
        });
      }
    }

    return {
      captures,
      envStructName: `%__env_${lambdaName}`
    };
  }

  private hasScopeVar(name: string): boolean {
    return this.scopeVarNames.indexOf(name) !== -1;
  }

  private getScopeVarType(name: string): string {
    const idx = this.scopeVarNames.indexOf(name);
    if (idx !== -1) {
      return this.scopeVarTypes[idx];
    }
    return 'double';
  }

  private walkBlock(block: BlockStatement): void {
    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i] as Statement;
      this.walkStatement(stmt);
    }
  }

  private walkStatement(stmt: Statement): void {
    const stmtTyped = stmt as TypedNode;
    const stmtType = stmtTyped.type;

    if (stmtType === 'variable_declaration') {
      const s = stmt as VarDeclNode;
      this.declaredVars.add(s.name);
      if (s.value) {
        this.walkExpression(s.value);
      }
    } else if (stmtType === 'assignment') {
      const s = stmt as AssignmentNode;
      this.walkExpression(s.target);
      this.walkExpression(s.value);
    } else if (stmtType === 'expression_statement') {
      const s = stmt as { type: string; expression: Expression };
      this.walkExpression(s.expression);
    } else if (stmtType === 'return') {
      const s = stmt as { type: string; value: Expression | null };
      if (s.value) {
        this.walkExpression(s.value);
      }
    } else if (stmtType === 'if') {
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
    } else if (stmtType === 'while') {
      const s = stmt as { type: string; condition: Expression; body: BlockStatement };
      this.walkExpression(s.condition);
      this.walkBlock(s.body);
    } else if (stmtType === 'for') {
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
    } else if (stmtType === 'for_of') {
      const s = stmt as { type: string; variable: string; iterable: Expression; body: BlockStatement };
      this.declaredVars.add(s.variable);
      this.walkExpression(s.iterable);
      this.walkBlock(s.body);
    } else if (stmtType === 'try') {
      const tryStmt = stmt as { tryBlock: BlockStatement; finallyBlock: BlockStatement | null };
      this.walkBlock(tryStmt.tryBlock);
      if (tryStmt.finallyBlock !== null) {
        this.walkBlock(tryStmt.finallyBlock);
      }
    }
  }

  private walkExpression(expr: Expression): void {
    const exprTyped = expr as { type: string };
    const exprType = exprTyped.type;

    if (exprType === 'variable') {
      const e = expr as { type: string; name: string };
      this.referencedVars.add(e.name);
    } else if (exprType === 'binary') {
      const e = expr as { type: string; left: Expression; right: Expression };
      this.walkExpression(e.left);
      this.walkExpression(e.right);
    } else if (exprType === 'unary') {
      const e = expr as { type: string; operand: Expression };
      this.walkExpression(e.operand);
    } else if (exprType === 'call') {
      const e = expr as { type: string; name: string; args: Expression[] };
      this.referencedVars.add(e.name);
      for (const arg of e.args) {
        this.walkExpression(arg);
      }
    } else if (exprType === 'method_call') {
      const e = expr as { type: string; object: Expression; args: Expression[] };
      this.walkExpression(e.object);
      for (const arg of e.args) {
        this.walkExpression(arg);
      }
    } else if (exprType === 'member_access') {
      const e = expr as { type: string; object: Expression };
      this.walkExpression(e.object);
    } else if (exprType === 'index_access') {
      const e = expr as { type: string; object: Expression; index: Expression };
      this.walkExpression(e.object);
      this.walkExpression(e.index);
    } else if (exprType === 'array') {
      const e = expr as { type: string; elements: Expression[] };
      for (const el of e.elements) {
        this.walkExpression(el);
      }
    } else if (exprType === 'object') {
      const e = expr as { type: string; properties: ObjectProperty[] };
      for (let i = 0; i < e.properties.length; i++) {
        const prop = e.properties[i] as ObjectProperty;
        this.walkExpression(prop.value);
      }
    } else if (exprType === 'template_literal') {
      const e = expr as { type: string; parts: (string | Expression)[] };
      for (const part of e.parts) {
        const partAsObj = part as { type: string };
        if (partAsObj.type) {
          this.walkExpression(part as Expression);
        }
      }
    } else if (exprType === 'arrow_function') {
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
    } else if (exprType === 'conditional') {
      const e = expr as { type: string; condition: Expression; consequent: Expression; alternate: Expression };
      this.walkExpression(e.condition);
      this.walkExpression(e.consequent);
      this.walkExpression(e.alternate);
    } else if (exprType === 'await') {
      const e = expr as { type: string; argument: Expression };
      this.walkExpression(e.argument);
    } else if (exprType === 'new') {
      const e = expr as { type: string; args: Expression[] };
      for (const arg of e.args) {
        this.walkExpression(arg);
      }
    }
    // 'this', 'super', 'number', 'string', 'boolean', 'regex' - no action needed
  }
}
