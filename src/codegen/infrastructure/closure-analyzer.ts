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

import type {
  Expression,
  BlockStatement,
  Statement,
  ObjectProperty,
  TryStatement,
} from "../../ast/types.js";

interface TypedNode {
  type: string;
}

interface VarDeclNode {
  type: string;
  kind: string;
  name: string;
  value: Expression | null;
}

interface AssignmentNode {
  type: string;
  name: string;
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
  variableKind: string;
  variableName: string;
  destructuredNames: string[] | null;
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
  catchParam: string | null;
  catchBody: BlockStatement | null;
  finallyBlock: BlockStatement | null;
}

interface VariableExpr {
  type: string;
  name: string;
}

interface BinaryExpr {
  type: string;
  op: string;
  left: Expression;
  right: Expression;
}

interface UnaryExpr {
  type: string;
  op: string;
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
  method: string;
  args: Expression[];
}

interface MemberAccessExpr {
  type: string;
  object: Expression;
  property: string;
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
  className: string;
  args: Expression[];
}

export interface CapturedVariable {
  name: string;
  llvmType: string;
  interfaceType?: string;
}

export interface ClosureInfo {
  captures: CapturedVariable[];
  envStructName: string;
}

export class ClosureAnalyzer {
  private declaredVars: Set<string>;
  private referencedVarsList: string[] = [];
  private scopeVarNames: string[] = [];
  private scopeVarTypes: string[] = [];
  private scopeVarInterfaceTypes: string[] = [];

  constructor() {
    this.declaredVars = new Set();
  }

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
    lambdaName: string,
    scopeVarInterfaceTypesIn?: string[],
  ): ClosureInfo {
    this.declaredVars = new Set();
    this.referencedVarsList = [];

    this.scopeVarNames = [];
    this.scopeVarTypes = [];
    this.scopeVarInterfaceTypes = [];
    for (let i = 0; i < scopeVarNamesIn.length; i++) {
      this.scopeVarNames.push(scopeVarNamesIn[i]);
      this.scopeVarTypes.push(scopeVarTypesIn[i]);
      this.scopeVarInterfaceTypes.push(
        scopeVarInterfaceTypesIn ? scopeVarInterfaceTypesIn[i] || "" : "",
      );
    }

    for (let _pi = 0; _pi < params.length; _pi++) {
      this.declaredVars.add(params[_pi]);
    }

    const bodyTyped = body as TypedNode;
    if (bodyTyped.type === "block") {
      this.walkBlock(body as BlockStatement);
    } else {
      this.walkExpression(body as Expression);
    }

    const captures: CapturedVariable[] = [];
    for (let _rvi = 0; _rvi < this.referencedVarsList.length; _rvi++) {
      const varName = this.referencedVarsList[_rvi];
      if (!this.declaredVars.has(varName) && this.hasScopeVar(varName)) {
        const idx = this.scopeVarNames.indexOf(varName);
        const ifaceType = idx >= 0 ? this.scopeVarInterfaceTypes[idx] : "";
        captures.push({
          name: varName,
          llvmType: this.getScopeVarType(varName),
          interfaceType: ifaceType || undefined,
        });
      }
    }

    return {
      captures,
      envStructName: `%__env_${lambdaName}`,
    };
  }

  private addReferencedVar(name: string): void {
    if (this.referencedVarsList.indexOf(name) === -1) {
      this.referencedVarsList.push(name);
    }
  }

  private hasScopeVar(name: string): boolean {
    return this.scopeVarNames.indexOf(name) !== -1;
  }

  private getScopeVarType(name: string): string {
    const idx = this.scopeVarNames.indexOf(name);
    if (idx !== -1) {
      return this.scopeVarTypes[idx];
    }
    return "double";
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

    if (stmtType === "variable_declaration") {
      const s = stmt as VarDeclNode;
      this.declaredVars.add(s.name);
      if (s.value) {
        this.walkExpression(s.value);
      }
    } else if (stmtType === "assignment") {
      const s = stmt as AssignmentNode;
      this.addReferencedVar(s.name);
      this.walkExpression(s.value);
    } else if (stmtType === "expression_statement") {
      const s = stmt as { type: string; expression: Expression };
      this.walkExpression(s.expression);
    } else if (stmtType === "return") {
      const s = stmt as { type: string; value: Expression | null };
      if (s.value) {
        this.walkExpression(s.value);
      }
    } else if (stmtType === "if") {
      const s = stmt as {
        type: string;
        condition: Expression;
        consequent: BlockStatement;
        alternate: Statement | BlockStatement | null;
      };
      this.walkExpression(s.condition);
      if (s.consequent) {
        this.walkBlock(s.consequent);
      }
      if (s.alternate) {
        const alt = s.alternate as { type: string };
        if (alt.type === "if") {
          this.walkStatement(s.alternate as Statement);
        } else {
          this.walkBlock(s.alternate as BlockStatement);
        }
      }
    } else if (stmtType === "while") {
      const s = stmt as { type: string; condition: Expression; body: BlockStatement };
      this.walkExpression(s.condition);
      this.walkBlock(s.body);
    } else if (stmtType === "for") {
      const s = stmt as {
        type: string;
        init: Statement | null;
        condition: Expression | null;
        update: Statement | Expression | null;
        body: BlockStatement;
      };
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
    } else if (stmtType === "for_of") {
      const s = stmt as {
        type: string;
        variableKind: string;
        variableName: string;
        destructuredNames: string[] | null;
        iterable: Expression;
        body: BlockStatement;
      };
      this.declaredVars.add(s.variableName);
      this.walkExpression(s.iterable);
      this.walkBlock(s.body);
    } else if (stmtType === "try") {
      const tryStmt = stmt as {
        type: string;
        tryBlock: BlockStatement;
        catchParam: string | null;
        catchBody: BlockStatement | null;
        finallyBlock: BlockStatement | null;
      };
      this.walkBlock(tryStmt.tryBlock);
      if (tryStmt.catchBody !== null) {
        this.walkBlock(tryStmt.catchBody);
      }
      if (tryStmt.finallyBlock !== null) {
        this.walkBlock(tryStmt.finallyBlock);
      }
    } else if (stmtType === "method_call") {
      const s = stmt as { type: string; object: Expression; method: string; args: Expression[] };
      this.walkExpression(s.object);
      for (let _ai = 0; _ai < s.args.length; _ai++) {
        this.walkExpression(s.args[_ai]);
      }
    } else if (stmtType === "call") {
      const s = stmt as { type: string; name: string; args: Expression[] };
      this.addReferencedVar(s.name);
      for (let _ai = 0; _ai < s.args.length; _ai++) {
        this.walkExpression(s.args[_ai]);
      }
    } else if (stmtType === "await") {
      const s = stmt as { type: string; argument: Expression };
      this.walkExpression(s.argument);
    }
  }

  private walkExpression(expr: Expression): void {
    const exprTyped = expr as { type: string };
    const exprType = exprTyped.type;

    if (exprType === "variable") {
      const e = expr as { type: string; name: string };
      this.addReferencedVar(e.name);
    } else if (exprType === "binary") {
      const e = expr as { type: string; op: string; left: Expression; right: Expression };
      this.walkExpression(e.left);
      this.walkExpression(e.right);
    } else if (exprType === "unary") {
      const e = expr as { type: string; op: string; operand: Expression };
      this.walkExpression(e.operand);
    } else if (exprType === "call") {
      const e = expr as { type: string; name: string; args: Expression[] };
      this.addReferencedVar(e.name);
      for (let _ai = 0; _ai < e.args.length; _ai++) {
        this.walkExpression(e.args[_ai]);
      }
    } else if (exprType === "method_call") {
      const e = expr as { type: string; object: Expression; method: string; args: Expression[] };
      this.walkExpression(e.object);
      for (let _ai2 = 0; _ai2 < e.args.length; _ai2++) {
        this.walkExpression(e.args[_ai2]);
      }
    } else if (exprType === "member_access") {
      const e = expr as { type: string; object: Expression; property: string };
      this.walkExpression(e.object);
    } else if (exprType === "index_access") {
      const e = expr as { type: string; object: Expression; index: Expression };
      this.walkExpression(e.object);
      this.walkExpression(e.index);
    } else if (exprType === "array") {
      const e = expr as { type: string; elements: Expression[] };
      for (let _eli = 0; _eli < e.elements.length; _eli++) {
        this.walkExpression(e.elements[_eli]);
      }
    } else if (exprType === "object") {
      const e = expr as { type: string; properties: ObjectProperty[] };
      for (let i = 0; i < e.properties.length; i++) {
        const prop = e.properties[i] as ObjectProperty;
        this.walkExpression(prop.value);
      }
    } else if (exprType === "template_literal") {
      const e = expr as { type: string; parts: (string | Expression)[] };
      for (let _pti = 0; _pti < e.parts.length; _pti++) {
        const part = e.parts[_pti];
        const partAsObj = part as { type: string };
        if (partAsObj.type && partAsObj.type !== "string") {
          this.walkExpression(part as Expression);
        }
      }
    } else if (exprType === "arrow_function") {
      const e = expr as { type: string; params: string[]; body: Expression | BlockStatement };
      const savedDeclaredVars = this.declaredVars;
      this.declaredVars = new Set();
      for (let _ppi = 0; _ppi < e.params.length; _ppi++) {
        this.declaredVars.add(e.params[_ppi]);
      }
      const bodyTyped = e.body as { type: string };
      if (bodyTyped.type === "block") {
        this.walkBlock(e.body as BlockStatement);
      } else {
        this.walkExpression(e.body as Expression);
      }
      this.declaredVars = savedDeclaredVars;
    } else if (exprType === "conditional") {
      const e = expr as {
        type: string;
        condition: Expression;
        consequent: Expression;
        alternate: Expression;
      };
      this.walkExpression(e.condition);
      this.walkExpression(e.consequent);
      this.walkExpression(e.alternate);
    } else if (exprType === "await") {
      const e = expr as { type: string; argument: Expression };
      this.walkExpression(e.argument);
    } else if (exprType === "new") {
      const e = expr as { type: string; className: string; args: Expression[] };
      for (let _nai = 0; _nai < e.args.length; _nai++) {
        this.walkExpression(e.args[_nai]);
      }
    }
    // 'this', 'super', 'number', 'string', 'boolean', 'regex' - no action needed
  }
}
