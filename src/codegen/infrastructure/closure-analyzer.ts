import type {
  Expression,
  BlockStatement,
  Statement,
  ObjectProperty,
  TryStatement,
  VariableDeclaration,
  AssignmentStatement,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  VariableNode,
  BinaryNode,
  UnaryNode,
  CallNode,
  MethodCallNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  TemplateLiteralNode,
  ArrowFunctionNode,
  ConditionalExpressionNode,
  AwaitExpressionNode,
  NewNode,
} from "../../ast/types.js";

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

    const bodyTyped = body as { type: string };
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
    console.log("error: variable '" + name + "' not found in closure scope");
    process.exit(1);
  }

  private walkBlock(block: BlockStatement): void {
    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i] as Statement;
      this.walkStatement(stmt);
    }
  }

  private walkStatement(stmt: Statement): void {
    const stmtTyped = stmt as { type: string };
    const stmtType = stmtTyped.type;

    if (stmtType === "variable_declaration") {
      const s = stmt as VariableDeclaration;
      this.declaredVars.add(s.name);
      if (s.value) {
        this.walkExpression(s.value);
      }
    } else if (stmtType === "assignment") {
      const s = stmt as AssignmentStatement;
      this.addReferencedVar(s.name);
      this.walkExpression(s.value);
    } else if (stmtType === "return") {
      const s = stmt as ReturnStatement;
      if (s.value) {
        this.walkExpression(s.value);
      }
    } else if (stmtType === "if") {
      const s = stmt as IfStatement;
      this.walkExpression(s.condition);
      if (s.thenBlock) {
        this.walkBlock(s.thenBlock);
      }
      if (s.elseBlock) {
        const elseTyped = s.elseBlock as { type: string };
        if (elseTyped.type === "if") {
          this.walkStatement(s.elseBlock as unknown as Statement);
        } else {
          this.walkBlock(s.elseBlock as BlockStatement);
        }
      }
    } else if (stmtType === "while") {
      const s = stmt as WhileStatement;
      this.walkExpression(s.condition);
      this.walkBlock(s.body);
    } else if (stmtType === "for") {
      const s = stmt as ForStatement;
      if (s.init) this.walkStatement(s.init as Statement);
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
      const s = stmt as ForOfStatement;
      this.declaredVars.add(s.variableName);
      this.walkExpression(s.iterable);
      this.walkBlock(s.body);
    } else if (stmtType === "try") {
      const tryStmt = stmt as TryStatement;
      this.walkBlock(tryStmt.tryBlock);
      if (tryStmt.catchBody !== null) {
        this.walkBlock(tryStmt.catchBody);
      }
      if (tryStmt.finallyBlock !== null) {
        this.walkBlock(tryStmt.finallyBlock);
      }
    } else if (stmtType === "method_call") {
      const s = stmt as unknown as MethodCallNode;
      this.walkExpression(s.object);
      for (let _ai = 0; _ai < s.args.length; _ai++) {
        this.walkExpression(s.args[_ai]);
      }
    } else if (stmtType === "call") {
      const s = stmt as unknown as CallNode;
      this.addReferencedVar(s.name);
      for (let _ai = 0; _ai < s.args.length; _ai++) {
        this.walkExpression(s.args[_ai]);
      }
    } else if (stmtType === "await") {
      const s = stmt as unknown as AwaitExpressionNode;
      this.walkExpression(s.argument);
    }
  }

  private walkExpression(expr: Expression): void {
    const exprType = expr.type;

    if (exprType === "variable") {
      const e = expr as VariableNode;
      this.addReferencedVar(e.name);
    } else if (exprType === "binary") {
      const e = expr as BinaryNode;
      this.walkExpression(e.left);
      this.walkExpression(e.right);
    } else if (exprType === "unary") {
      const e = expr as UnaryNode;
      this.walkExpression(e.operand);
    } else if (exprType === "call") {
      const e = expr as CallNode;
      this.addReferencedVar(e.name);
      for (let _ai = 0; _ai < e.args.length; _ai++) {
        this.walkExpression(e.args[_ai]);
      }
    } else if (exprType === "method_call") {
      const e = expr as MethodCallNode;
      this.walkExpression(e.object);
      for (let _ai2 = 0; _ai2 < e.args.length; _ai2++) {
        this.walkExpression(e.args[_ai2]);
      }
    } else if (exprType === "member_access") {
      const e = expr as MemberAccessNode;
      this.walkExpression(e.object);
    } else if (exprType === "index_access") {
      const e = expr as IndexAccessNode;
      this.walkExpression(e.object);
      this.walkExpression(e.index);
    } else if (exprType === "array") {
      const e = expr as ArrayNode;
      for (let _eli = 0; _eli < e.elements.length; _eli++) {
        this.walkExpression(e.elements[_eli]);
      }
    } else if (exprType === "object") {
      const e = expr as ObjectNode;
      for (let i = 0; i < e.properties.length; i++) {
        const prop = e.properties[i] as ObjectProperty;
        this.walkExpression(prop.value);
      }
    } else if (exprType === "template_literal") {
      const e = expr as TemplateLiteralNode;
      for (let _pti = 0; _pti < e.parts.length; _pti++) {
        const part = e.parts[_pti];
        if (typeof part !== "string") {
          this.walkExpression(part);
        }
      }
    } else if (exprType === "arrow_function") {
      const e = expr as ArrowFunctionNode;
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
      const e = expr as ConditionalExpressionNode;
      this.walkExpression(e.condition);
      this.walkExpression(e.consequent);
      this.walkExpression(e.alternate);
    } else if (exprType === "await") {
      const e = expr as AwaitExpressionNode;
      this.walkExpression(e.argument);
    } else if (exprType === "new") {
      const e = expr as NewNode;
      for (let _nai = 0; _nai < e.args.length; _nai++) {
        this.walkExpression(e.args[_nai]);
      }
    }
  }
}
