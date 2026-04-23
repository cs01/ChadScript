// Escape analysis semantic pass — runs before IR generation.
// Identifies local object-literal variables that do not escape their function scope.
// These can be stack-allocated (alloca) instead of heap-allocated (GC_malloc),
// eliminating allocation cost and GC pressure for short-lived objects.
//
// Conservative: a variable is stack-eligible only when we can PROVE it doesn't escape.
// False "escape" is always safe; false "no-escape" would produce dangling pointers.

import type {
  AST,
  Statement,
  Expression,
  BlockStatement,
  VariableDeclaration,
  AssignmentStatement,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  ThrowStatement,
  TryStatement,
  SwitchStatement,
  SwitchCase,
  FunctionNode,
  ClassNode,
  ClassMethod,
  CallNode,
  MethodCallNode,
  BinaryNode,
  UnaryNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  ObjectProperty,
  ArrowFunctionNode,
  TemplateLiteralNode,
  ConditionalExpressionNode,
  AwaitExpressionNode,
  MemberAccessAssignmentNode,
  IndexAccessAssignmentNode,
  TypeAssertionNode,
  NewNode,
  SpreadElementNode,
  VariableNode,
} from "../ast/types.js";

export function varDeclKey(decl: VariableDeclaration): string {
  const line = decl.loc ? decl.loc.line : decl.line ? decl.line : -1;
  const col = decl.loc ? decl.loc.column : -1;
  return decl.name + ":" + line + ":" + col;
}

export function analyzeEscapes(ast: AST): string[] {
  const result: string[] = [];
  const analyzer = new EscapeAnalyzer();

  for (let i = 0; i < ast.functions.length; i++) {
    const func = ast.functions[i] as FunctionNode;
    if (func.declare || !func.body) continue;
    analyzer.analyzeBlock(func.body, result);
  }

  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i] as ClassNode;
    for (let j = 0; j < cls.methods.length; j++) {
      const method = cls.methods[j] as ClassMethod;
      analyzer.analyzeBlock(method.body, result);
    }
  }

  return result;
}

interface StmtBase {
  type: string;
}

interface ExprBase {
  type: string;
}

class EscapeAnalyzer {
  private candidateDecls: VariableDeclaration[] = [];
  private candidateNames: string[] = [];
  private escapedNames: string[] = [];

  analyzeBlock(body: BlockStatement, result: string[]): void {
    this.candidateDecls = [];
    this.candidateNames = [];
    this.escapedNames = [];

    this.collectCandidates(body.statements);
    if (this.candidateDecls.length > 0) this.scanBlockForEscapes(body);

    for (let i = 0; i < this.candidateDecls.length; i++) {
      const decl = this.candidateDecls[i] as VariableDeclaration;
      const name = this.candidateNames[i] as string;
      if (!this.isEscaped(name)) {
        result.push(varDeclKey(decl));
      }
    }
  }

  private blockContainsArrow(stmts: Statement[]): boolean {
    for (let i = 0; i < stmts.length; i++) {
      if (this.stmtContainsArrow(stmts[i])) return true;
    }
    return false;
  }

  private stmtContainsArrow(stmt: Statement): boolean {
    const s = stmt as StmtBase;
    if (s.type === "variable_declaration") {
      const d = stmt as VariableDeclaration;
      return d.value ? this.exprContainsArrow(d.value) : false;
    }
    if (s.type === "assignment") {
      const a = stmt as AssignmentStatement;
      return this.exprContainsArrow(a.value);
    }
    if (s.type === "return") {
      const r = stmt as ReturnStatement;
      return r.value ? this.exprContainsArrow(r.value) : false;
    }
    if (s.type === "if") {
      const i = stmt as IfStatement;
      return (
        this.exprContainsArrow(i.condition) ||
        this.blockContainsArrow(i.thenBlock.statements) ||
        (i.elseBlock ? this.blockContainsArrow(i.elseBlock.statements) : false)
      );
    }
    if (s.type === "while" || s.type === "do_while") {
      const w = stmt as WhileStatement;
      return this.exprContainsArrow(w.condition) || this.blockContainsArrow(w.body.statements);
    }
    if (s.type === "for") {
      const f = stmt as ForStatement;
      return this.blockContainsArrow(f.body.statements);
    }
    if (s.type === "for_of") {
      const f = stmt as ForOfStatement;
      return this.exprContainsArrow(f.iterable) || this.blockContainsArrow(f.body.statements);
    }
    if (s.type === "try") {
      const t = stmt as TryStatement;
      return (
        this.blockContainsArrow(t.tryBlock.statements) ||
        (t.catchBody ? this.blockContainsArrow(t.catchBody.statements) : false) ||
        (t.finallyBlock ? this.blockContainsArrow(t.finallyBlock.statements) : false)
      );
    }
    if (s.type === "switch") {
      const sw = stmt as SwitchStatement;
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as SwitchCase;
        if (this.blockContainsArrow(c.consequent)) return true;
      }
      return false;
    }
    if (s.type === "block") {
      const b = stmt as BlockStatement;
      return this.blockContainsArrow(b.statements);
    }
    return this.exprContainsArrow(stmt as Expression);
  }

  private exprContainsArrow(expr: Expression): boolean {
    const e = expr as ExprBase;
    if (e.type === "arrow_function") return true;
    if (
      e.type === "number" ||
      e.type === "string" ||
      e.type === "boolean" ||
      e.type === "null" ||
      e.type === "undefined" ||
      e.type === "regex" ||
      e.type === "variable" ||
      e.type === "this" ||
      e.type === "super"
    ) {
      return false;
    }
    if (e.type === "call") {
      const c = expr as CallNode;
      for (let i = 0; i < c.args.length; i++) {
        if (this.exprContainsArrow(c.args[i])) return true;
      }
      return false;
    }
    if (e.type === "method_call") {
      const m = expr as MethodCallNode;
      if (this.exprContainsArrow(m.object)) return true;
      for (let i = 0; i < m.args.length; i++) {
        if (this.exprContainsArrow(m.args[i])) return true;
      }
      return false;
    }
    if (e.type === "new") {
      const n = expr as NewNode;
      for (let i = 0; i < n.args.length; i++) {
        if (this.exprContainsArrow(n.args[i])) return true;
      }
      return false;
    }
    if (e.type === "binary") {
      const b = expr as BinaryNode;
      return this.exprContainsArrow(b.left) || this.exprContainsArrow(b.right);
    }
    if (e.type === "unary") {
      const u = expr as UnaryNode;
      return this.exprContainsArrow(u.operand);
    }
    if (e.type === "member_access") {
      const m = expr as MemberAccessNode;
      return this.exprContainsArrow(m.object);
    }
    if (e.type === "index_access") {
      const i = expr as IndexAccessNode;
      return this.exprContainsArrow(i.object) || this.exprContainsArrow(i.index);
    }
    if (e.type === "array") {
      const a = expr as ArrayNode;
      for (let i = 0; i < a.elements.length; i++) {
        if (this.exprContainsArrow(a.elements[i])) return true;
      }
      return false;
    }
    if (e.type === "object") {
      const o = expr as ObjectNode;
      for (let i = 0; i < o.properties.length; i++) {
        const prop = o.properties[i] as ObjectProperty;
        if (this.exprContainsArrow(prop.value)) return true;
      }
      return false;
    }
    if (e.type === "conditional") {
      const c = expr as ConditionalExpressionNode;
      return (
        this.exprContainsArrow(c.condition) ||
        this.exprContainsArrow(c.consequent) ||
        this.exprContainsArrow(c.alternate)
      );
    }
    if (e.type === "template_literal") {
      const t = expr as TemplateLiteralNode;
      for (let i = 0; i < t.parts.length; i++) {
        const part = t.parts[i];
        if (typeof part !== "string" && this.exprContainsArrow(part as Expression)) return true;
      }
      return false;
    }
    if (e.type === "await") {
      const a = expr as AwaitExpressionNode;
      return this.exprContainsArrow(a.argument);
    }
    if (e.type === "member_access_assignment") {
      const m = expr as MemberAccessAssignmentNode;
      return this.exprContainsArrow(m.object) || this.exprContainsArrow(m.value);
    }
    if (e.type === "index_access_assignment") {
      const i = expr as IndexAccessAssignmentNode;
      return this.exprContainsArrow(i.object) || this.exprContainsArrow(i.value);
    }
    if (e.type === "type_assertion") {
      const t = expr as TypeAssertionNode;
      return this.exprContainsArrow(t.expression);
    }
    return false;
  }

  private isEscaped(name: string): boolean {
    for (let i = 0; i < this.escapedNames.length; i++) {
      if (this.escapedNames[i] === name) return true;
    }
    return false;
  }

  private isObjectLiteralInit(value: Expression | null): boolean {
    if (!value) return false;
    const v = value as ExprBase;
    return v.type === "object";
  }

  private collectCandidates(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i] as StmtBase;
      if (stmt.type === "variable_declaration") {
        const decl = stmt as VariableDeclaration;
        if (decl.kind === "const" && this.isObjectLiteralInit(decl.value)) {
          this.candidateDecls.push(decl);
          this.candidateNames.push(decl.name);
        }
      }
      this.collectCandidatesFromStmt(stmts[i]);
    }
  }

  private collectCandidatesFromStmt(stmt: Statement): void {
    const s = stmt as StmtBase;
    if (s.type === "if") {
      const ifStmt = stmt as IfStatement;
      this.collectCandidates(ifStmt.thenBlock.statements);
      if (ifStmt.elseBlock) {
        this.collectCandidates(ifStmt.elseBlock.statements);
      }
    } else if (s.type === "while" || s.type === "do_while") {
      const w = stmt as WhileStatement;
      this.collectCandidates(w.body.statements);
    } else if (s.type === "for") {
      const f = stmt as ForStatement;
      this.collectCandidates(f.body.statements);
    } else if (s.type === "for_of") {
      const f = stmt as ForOfStatement;
      this.collectCandidates(f.body.statements);
    } else if (s.type === "try") {
      const t = stmt as TryStatement;
      this.collectCandidates(t.tryBlock.statements);
      if (t.catchBody) this.collectCandidates(t.catchBody.statements);
      if (t.finallyBlock) this.collectCandidates(t.finallyBlock.statements);
    } else if (s.type === "switch") {
      const sw = stmt as SwitchStatement;
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as SwitchCase;
        this.collectCandidates(c.consequent);
      }
    } else if (s.type === "block") {
      const b = stmt as BlockStatement;
      this.collectCandidates(b.statements);
    }
  }

  private scanBlockForEscapes(body: BlockStatement): void {
    for (let i = 0; i < body.statements.length; i++) {
      this.scanStmtForEscapes(body.statements[i]);
    }
  }

  private scanStmtForEscapes(stmt: Statement): void {
    const s = stmt as StmtBase;
    if (s.type === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.value) {
        const v = decl.value as ExprBase;
        if (v.type === "variable") {
          const varRef = decl.value as VariableNode;
          this.escapedNames.push(varRef.name);
        } else {
          this.walkExprEscaping(decl.value);
        }
      }
    } else if (s.type === "assignment") {
      const a = stmt as AssignmentStatement;
      const v = a.value as ExprBase;
      if (v.type === "variable") {
        const varRef = a.value as VariableNode;
        this.escapedNames.push(varRef.name);
      } else {
        this.walkExprEscaping(a.value);
      }
    } else if (s.type === "return") {
      const r = stmt as ReturnStatement;
      if (r.value) this.walkExprEscaping(r.value);
    } else if (s.type === "throw") {
      const t = stmt as ThrowStatement;
      this.walkExprEscaping(t.argument);
    } else if (s.type === "if") {
      const ifStmt = stmt as IfStatement;
      this.walkExprNonEscaping(ifStmt.condition);
      this.scanBlockForEscapes(ifStmt.thenBlock);
      if (ifStmt.elseBlock) this.scanBlockForEscapes(ifStmt.elseBlock);
    } else if (s.type === "while" || s.type === "do_while") {
      const w = stmt as WhileStatement;
      this.walkExprNonEscaping(w.condition);
      this.scanBlockForEscapes(w.body);
    } else if (s.type === "for") {
      const f = stmt as ForStatement;
      if (f.init) this.scanStmtForEscapes(f.init as Statement);
      if (f.condition) this.walkExprNonEscaping(f.condition);
      if (f.update) {
        const upd = f.update as ExprBase;
        if (upd.type === "assignment") {
          this.scanStmtForEscapes(f.update as Statement);
        } else {
          this.walkExprNonEscaping(f.update as Expression);
        }
      }
      this.scanBlockForEscapes(f.body);
    } else if (s.type === "for_of") {
      const f = stmt as ForOfStatement;
      this.walkExprNonEscaping(f.iterable);
      this.scanBlockForEscapes(f.body);
    } else if (s.type === "try") {
      const t = stmt as TryStatement;
      this.scanBlockForEscapes(t.tryBlock);
      if (t.catchBody) this.scanBlockForEscapes(t.catchBody);
      if (t.finallyBlock) this.scanBlockForEscapes(t.finallyBlock);
    } else if (s.type === "switch") {
      const sw = stmt as SwitchStatement;
      this.walkExprNonEscaping(sw.discriminant);
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as SwitchCase;
        if (c.test) this.walkExprNonEscaping(c.test);
        for (let j = 0; j < c.consequent.length; j++) {
          this.scanStmtForEscapes(c.consequent[j]);
        }
      }
    } else if (s.type === "block") {
      const b = stmt as BlockStatement;
      this.scanBlockForEscapes(b);
    } else {
      this.walkExprNonEscaping(stmt as Expression);
    }
  }

  private walkExprEscaping(expr: Expression): void {
    const e = expr as ExprBase;
    if (e.type === "variable") {
      const v = expr as VariableNode;
      this.escapedNames.push(v.name);
      return;
    }
    this.walkExprInner(expr, true);
  }

  private walkExprNonEscaping(expr: Expression): void {
    const e = expr as ExprBase;
    if (e.type === "variable") return;
    this.walkExprInner(expr, false);
  }

  private walkExprInner(expr: Expression, isEscaping: boolean): void {
    const e = expr as ExprBase;
    if (
      e.type === "number" ||
      e.type === "string" ||
      e.type === "boolean" ||
      e.type === "null" ||
      e.type === "undefined" ||
      e.type === "regex" ||
      e.type === "this" ||
      e.type === "super"
    ) {
      return;
    }
    if (e.type === "variable") {
      if (isEscaping) {
        const v = expr as VariableNode;
        this.escapedNames.push(v.name);
      }
      return;
    }
    if (e.type === "call") {
      const c = expr as CallNode;
      for (let i = 0; i < c.args.length; i++) {
        this.walkExprEscaping(c.args[i]);
      }
      return;
    }
    if (e.type === "method_call") {
      const m = expr as MethodCallNode;
      if (isEscaping) {
        this.walkExprEscaping(m.object);
      } else {
        this.walkExprNonEscaping(m.object);
      }
      for (let i = 0; i < m.args.length; i++) {
        this.walkExprEscaping(m.args[i]);
      }
      return;
    }
    if (e.type === "new") {
      const n = expr as NewNode;
      for (let i = 0; i < n.args.length; i++) {
        this.walkExprEscaping(n.args[i]);
      }
      return;
    }
    if (e.type === "binary") {
      const b = expr as BinaryNode;
      this.walkExprNonEscaping(b.left);
      this.walkExprNonEscaping(b.right);
      return;
    }
    if (e.type === "unary") {
      const u = expr as UnaryNode;
      this.walkExprNonEscaping(u.operand);
      return;
    }
    if (e.type === "member_access") {
      const m = expr as MemberAccessNode;
      if (isEscaping) {
        this.walkExprEscaping(m.object);
      } else {
        this.walkExprNonEscaping(m.object);
      }
      return;
    }
    if (e.type === "index_access") {
      const i = expr as IndexAccessNode;
      if (isEscaping) {
        this.walkExprEscaping(i.object);
      } else {
        this.walkExprNonEscaping(i.object);
      }
      this.walkExprNonEscaping(i.index);
      return;
    }
    if (e.type === "array") {
      const a = expr as ArrayNode;
      for (let i = 0; i < a.elements.length; i++) {
        this.walkExprEscaping(a.elements[i]);
      }
      return;
    }
    if (e.type === "object") {
      const o = expr as ObjectNode;
      for (let i = 0; i < o.properties.length; i++) {
        const prop = o.properties[i] as ObjectProperty;
        this.walkExprEscaping(prop.value);
      }
      return;
    }
    if (e.type === "arrow_function") {
      const a = expr as ArrowFunctionNode;
      if ((a.body as ExprBase).type === "block") {
        const block = a.body as BlockStatement;
        this.scanBlockForArrowEscapes(block);
      } else {
        this.scanArrowExprForEscapes(a.body as Expression);
      }
      return;
    }
    if (e.type === "template_literal") {
      const t = expr as TemplateLiteralNode;
      for (let i = 0; i < t.parts.length; i++) {
        const part = t.parts[i];
        if (typeof part !== "string") {
          this.walkExprNonEscaping(part as Expression);
        }
      }
      return;
    }
    if (e.type === "conditional") {
      const c = expr as ConditionalExpressionNode;
      this.walkExprNonEscaping(c.condition);
      if (isEscaping) {
        this.walkExprEscaping(c.consequent);
        this.walkExprEscaping(c.alternate);
      } else {
        this.walkExprNonEscaping(c.consequent);
        this.walkExprNonEscaping(c.alternate);
      }
      return;
    }
    if (e.type === "await") {
      const a = expr as AwaitExpressionNode;
      this.walkExprEscaping(a.argument);
      return;
    }
    if (e.type === "member_access_assignment") {
      const m = expr as MemberAccessAssignmentNode;
      if (isEscaping) {
        this.walkExprEscaping(m.object);
      } else {
        this.walkExprNonEscaping(m.object);
      }
      this.walkExprEscaping(m.value);
      return;
    }
    if (e.type === "index_access_assignment") {
      const i = expr as IndexAccessAssignmentNode;
      if (isEscaping) {
        this.walkExprEscaping(i.object);
      } else {
        this.walkExprNonEscaping(i.object);
      }
      this.walkExprNonEscaping(i.index);
      this.walkExprEscaping(i.value);
      return;
    }
    if (e.type === "type_assertion") {
      const t = expr as TypeAssertionNode;
      if (isEscaping) {
        this.walkExprEscaping(t.expression);
      } else {
        this.walkExprNonEscaping(t.expression);
      }
      return;
    }
    if (e.type === "spread_element") {
      const s = expr as SpreadElementNode;
      this.walkExprEscaping(s.argument);
      return;
    }
  }

  private scanBlockForArrowEscapes(block: BlockStatement): void {
    for (let i = 0; i < block.statements.length; i++) {
      this.scanArrowStmtForEscapes(block.statements[i]);
    }
  }

  private scanArrowStmtForEscapes(stmt: Statement): void {
    const s = stmt as StmtBase;
    if (s.type === "return") {
      const r = stmt as ReturnStatement;
      if (r.value) this.walkExprEscaping(r.value);
    } else if (s.type === "variable_declaration") {
      const d = stmt as VariableDeclaration;
      if (d.value) this.walkExprEscaping(d.value);
    } else if (s.type === "assignment") {
      const a = stmt as AssignmentStatement;
      this.walkExprEscaping(a.value);
    } else if (s.type === "if") {
      const i = stmt as IfStatement;
      this.walkExprEscaping(i.condition);
      this.scanBlockForArrowEscapes(i.thenBlock);
      if (i.elseBlock) this.scanBlockForArrowEscapes(i.elseBlock);
    } else if (s.type === "while" || s.type === "do_while") {
      const w = stmt as WhileStatement;
      this.walkExprEscaping(w.condition);
      this.scanBlockForArrowEscapes(w.body);
    } else if (s.type === "for") {
      const f = stmt as ForStatement;
      if (f.init) this.scanArrowStmtForEscapes(f.init as Statement);
      if (f.condition) this.walkExprEscaping(f.condition);
      if (f.update) {
        const upd = f.update as ExprBase;
        if (upd.type === "assignment") {
          this.scanArrowStmtForEscapes(f.update as Statement);
        } else {
          this.walkExprEscaping(f.update as Expression);
        }
      }
      this.scanBlockForArrowEscapes(f.body);
    } else if (s.type === "for_of") {
      const f = stmt as ForOfStatement;
      this.walkExprEscaping(f.iterable);
      this.scanBlockForArrowEscapes(f.body);
    } else if (s.type === "try") {
      const t = stmt as TryStatement;
      this.scanBlockForArrowEscapes(t.tryBlock);
      if (t.catchBody) this.scanBlockForArrowEscapes(t.catchBody);
      if (t.finallyBlock) this.scanBlockForArrowEscapes(t.finallyBlock);
    } else if (s.type === "switch") {
      const sw = stmt as SwitchStatement;
      this.walkExprEscaping(sw.discriminant);
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as SwitchCase;
        if (c.test) this.walkExprEscaping(c.test);
        for (let j = 0; j < c.consequent.length; j++) {
          this.scanArrowStmtForEscapes(c.consequent[j]);
        }
      }
    } else if (s.type === "throw") {
      const t = stmt as ThrowStatement;
      this.walkExprEscaping(t.argument);
    } else if (s.type === "block") {
      const b = stmt as BlockStatement;
      this.scanBlockForArrowEscapes(b);
    } else {
      this.scanArrowExprForEscapes(stmt as Expression);
    }
  }

  private scanArrowExprForEscapes(expr: Expression): void {
    this.walkExprEscaping(expr);
  }
}
