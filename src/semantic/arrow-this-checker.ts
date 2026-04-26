import type {
  AST,
  Statement,
  Expression,
  ArrowFunctionNode,
  BinaryNode,
  UnaryNode,
  ConditionalExpressionNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  TypeAssertionNode,
  AwaitExpressionNode,
  NewNode,
  CallNode,
  MethodCallNode,
  BlockStatement,
  SourceLocation,
  ClassNode,
  ClassMethod,
  FunctionNode,
  VariableDeclaration,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  SwitchCase,
  ReturnStatement,
  AssignmentStatement,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

function emitError(loc: SourceLocation | undefined, sourceCode: string): void {
  const output = formatCompileError(
    sourceCode,
    "Arrow functions cannot capture 'this'. Use a local variable instead: const self = this",
    loc,
    undefined,
    [],
  );
  process.stderr.write(output);
  process.exit(1);
}

function exprContainsThis(expr: Expression): SourceLocation | undefined {
  if (!expr) return undefined;
  const e = expr as { type: string; loc?: SourceLocation };

  if (e.type === "this") return e.loc;
  if (e.type === "function") return undefined;

  if (e.type === "arrow_function") {
    const arrow = expr as unknown as ArrowFunctionNode;
    const b = arrow.body as { type: string };
    if (b.type === "block") {
      return blockContainsThis(arrow.body as BlockStatement);
    }
    return exprContainsThis(arrow.body as Expression);
  }

  if (e.type === "method_call") {
    const mc = expr as unknown as MethodCallNode;
    const r = exprContainsThis(mc.object);
    if (r) return r;
    for (let i = 0; i < mc.args.length; i++) {
      const r2 = exprContainsThis(mc.args[i]);
      if (r2) return r2;
    }
    return undefined;
  }

  if (e.type === "call") {
    const call = expr as unknown as CallNode;
    for (let i = 0; i < call.args.length; i++) {
      const r2 = exprContainsThis(call.args[i]);
      if (r2) return r2;
    }
    return undefined;
  }

  if (e.type === "member_access") {
    const ma = expr as unknown as MemberAccessNode;
    return exprContainsThis(ma.object);
  }

  if (e.type === "binary") {
    const bin = expr as unknown as BinaryNode;
    const r = exprContainsThis(bin.left);
    if (r) return r;
    return exprContainsThis(bin.right);
  }

  if (e.type === "unary") {
    const un = expr as unknown as UnaryNode;
    return exprContainsThis(un.operand);
  }

  if (e.type === "conditional") {
    const cond = expr as unknown as ConditionalExpressionNode;
    const r = exprContainsThis(cond.condition);
    if (r) return r;
    const r2 = exprContainsThis(cond.consequent);
    if (r2) return r2;
    return exprContainsThis(cond.alternate);
  }

  if (e.type === "assignment") {
    const assign = expr as unknown as AssignmentStatement;
    return exprContainsThis(assign.value as Expression);
  }

  if (e.type === "index_access") {
    const idx = expr as unknown as IndexAccessNode;
    const r = exprContainsThis(idx.object);
    if (r) return r;
    return exprContainsThis(idx.index);
  }

  if (e.type === "array") {
    const arr = expr as unknown as ArrayNode;
    for (let i = 0; i < arr.elements.length; i++) {
      const r = exprContainsThis(arr.elements[i]);
      if (r) return r;
    }
    return undefined;
  }

  if (e.type === "object") {
    const obj = expr as unknown as ObjectNode;
    for (let i = 0; i < obj.properties.length; i++) {
      const r = exprContainsThis(obj.properties[i].value);
      if (r) return r;
    }
    return undefined;
  }

  if (e.type === "type_assertion") {
    const ta = expr as unknown as TypeAssertionNode;
    return exprContainsThis(ta.expression);
  }

  if (e.type === "await") {
    const aw = expr as unknown as AwaitExpressionNode;
    return exprContainsThis(aw.argument);
  }

  if (e.type === "new") {
    const nw = expr as unknown as NewNode;
    if (nw.args) {
      for (let i = 0; i < nw.args.length; i++) {
        const r = exprContainsThis(nw.args[i]);
        if (r) return r;
      }
    }
    return undefined;
  }

  return undefined;
}

function stmtContainsThis(stmt: Statement): SourceLocation | undefined {
  if (!stmt) return undefined;
  const s = stmt as { type: string };

  if (s.type === "variable_declaration") {
    const decl = stmt as unknown as VariableDeclaration;
    if (decl.value) return exprContainsThis(decl.value as Expression);
    return undefined;
  }

  if (s.type === "expression") {
    const es = stmt as { type: string; expression: Expression };
    return exprContainsThis(es.expression);
  }

  if (s.type === "return") {
    const ret = stmt as unknown as ReturnStatement;
    if (ret.value) return exprContainsThis(ret.value as Expression);
    return undefined;
  }

  if (s.type === "assignment" || s.type === "member_access_assignment") {
    const assign = stmt as unknown as AssignmentStatement;
    if (assign.value) return exprContainsThis(assign.value as Expression);
    return undefined;
  }

  if (s.type === "if") {
    const ifStmt = stmt as unknown as IfStatement;
    const r = exprContainsThis(ifStmt.condition as Expression);
    if (r) return r;
    const r2 = blockContainsThis(ifStmt.thenBlock);
    if (r2) return r2;
    if (ifStmt.elseBlock) return blockContainsThis(ifStmt.elseBlock);
    return undefined;
  }

  if (s.type === "while") {
    const w = stmt as unknown as WhileStatement;
    const r = exprContainsThis(w.condition as Expression);
    if (r) return r;
    return blockContainsThis(w.body);
  }

  if (s.type === "for") {
    const f = stmt as unknown as ForStatement;
    if (f.init) {
      const r = stmtContainsThis(f.init as Statement);
      if (r) return r;
    }
    if (f.condition) {
      const r = exprContainsThis(f.condition as Expression);
      if (r) return r;
    }
    if (f.update) {
      const r = exprContainsThis(f.update as Expression);
      if (r) return r;
    }
    return blockContainsThis(f.body);
  }

  if (s.type === "for_of") {
    const fo = stmt as unknown as ForOfStatement;
    if (fo.iterable) {
      const r = exprContainsThis(fo.iterable as Expression);
      if (r) return r;
    }
    return blockContainsThis(fo.body);
  }

  if (s.type === "try") {
    const t = stmt as unknown as TryStatement;
    const r = blockContainsThis(t.tryBlock);
    if (r) return r;
    if (t.catchBody) {
      const r2 = blockContainsThis(t.catchBody);
      if (r2) return r2;
    }
    if (t.finallyBlock) return blockContainsThis(t.finallyBlock);
    return undefined;
  }

  if (s.type === "switch") {
    const sw = stmt as unknown as SwitchStatement;
    const r = exprContainsThis(sw.discriminant as Expression);
    if (r) return r;
    if (sw.cases) {
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as unknown as SwitchCase;
        if (c.consequent) {
          const r2 = statementsContainThis(c.consequent);
          if (r2) return r2;
        }
      }
    }
    return undefined;
  }

  if (s.type === "function") return undefined;

  return undefined;
}

function blockContainsThis(body: BlockStatement): SourceLocation | undefined {
  if (!body) return undefined;
  if (body.statements) return statementsContainThis(body.statements as Statement[]);
  return undefined;
}

function statementsContainThis(stmts: Statement[]): SourceLocation | undefined {
  for (let i = 0; i < stmts.length; i++) {
    const r = stmtContainsThis(stmts[i]);
    if (r) return r;
  }
  return undefined;
}

function walkExprForArrows(expr: Expression, sourceCode: string): void {
  if (!expr) return;
  const e = expr as { type: string };

  if (e.type === "arrow_function") {
    const arrow = expr as unknown as ArrowFunctionNode;
    const b = arrow.body as { type: string };
    let loc: SourceLocation | undefined;
    if (b.type === "block") {
      loc = blockContainsThis(arrow.body as BlockStatement);
    } else {
      loc = exprContainsThis(arrow.body as Expression);
    }
    if (loc) emitError(loc, sourceCode);
    return;
  }

  if (e.type === "function") return;

  if (e.type === "method_call") {
    const mc = expr as unknown as MethodCallNode;
    walkExprForArrows(mc.object, sourceCode);
    for (let i = 0; i < mc.args.length; i++) {
      walkExprForArrows(mc.args[i], sourceCode);
    }
    return;
  }

  if (e.type === "call") {
    const call = expr as unknown as CallNode;
    for (let i = 0; i < call.args.length; i++) {
      walkExprForArrows(call.args[i], sourceCode);
    }
    return;
  }

  if (e.type === "binary") {
    const bin = expr as unknown as BinaryNode;
    walkExprForArrows(bin.left, sourceCode);
    walkExprForArrows(bin.right, sourceCode);
    return;
  }

  if (e.type === "unary") {
    const un = expr as unknown as UnaryNode;
    walkExprForArrows(un.operand, sourceCode);
    return;
  }

  if (e.type === "conditional") {
    const cond = expr as unknown as ConditionalExpressionNode;
    walkExprForArrows(cond.condition, sourceCode);
    walkExprForArrows(cond.consequent, sourceCode);
    walkExprForArrows(cond.alternate, sourceCode);
    return;
  }

  if (e.type === "member_access") {
    const ma = expr as unknown as MemberAccessNode;
    walkExprForArrows(ma.object, sourceCode);
    return;
  }

  if (e.type === "index_access") {
    const idx = expr as unknown as IndexAccessNode;
    walkExprForArrows(idx.object, sourceCode);
    walkExprForArrows(idx.index, sourceCode);
    return;
  }

  if (e.type === "array") {
    const arr = expr as unknown as ArrayNode;
    for (let i = 0; i < arr.elements.length; i++) {
      walkExprForArrows(arr.elements[i], sourceCode);
    }
    return;
  }

  if (e.type === "object") {
    const obj = expr as unknown as ObjectNode;
    for (let i = 0; i < obj.properties.length; i++) {
      walkExprForArrows(obj.properties[i].value, sourceCode);
    }
    return;
  }

  if (e.type === "assignment") {
    const assign = expr as unknown as AssignmentStatement;
    walkExprForArrows(assign.value as Expression, sourceCode);
    return;
  }

  if (e.type === "type_assertion") {
    const ta = expr as unknown as TypeAssertionNode;
    walkExprForArrows(ta.expression, sourceCode);
    return;
  }

  if (e.type === "await") {
    const aw = expr as unknown as AwaitExpressionNode;
    walkExprForArrows(aw.argument, sourceCode);
    return;
  }

  if (e.type === "new") {
    const nw = expr as unknown as NewNode;
    if (nw.args) {
      for (let i = 0; i < nw.args.length; i++) {
        walkExprForArrows(nw.args[i], sourceCode);
      }
    }
    return;
  }
}

function walkStmtForArrows(stmt: Statement, sourceCode: string): void {
  if (!stmt) return;
  const s = stmt as { type: string };

  if (s.type === "variable_declaration") {
    const decl = stmt as unknown as VariableDeclaration;
    if (decl.value) walkExprForArrows(decl.value as Expression, sourceCode);
    return;
  }

  if (s.type === "expression") {
    const es = stmt as { type: string; expression: Expression };
    walkExprForArrows(es.expression, sourceCode);
    return;
  }

  if (s.type === "return") {
    const ret = stmt as unknown as ReturnStatement;
    if (ret.value) walkExprForArrows(ret.value as Expression, sourceCode);
    return;
  }

  if (s.type === "assignment" || s.type === "member_access_assignment") {
    const assign = stmt as unknown as AssignmentStatement;
    if (assign.value) walkExprForArrows(assign.value as Expression, sourceCode);
    return;
  }

  if (s.type === "if") {
    const ifStmt = stmt as unknown as IfStatement;
    walkExprForArrows(ifStmt.condition as Expression, sourceCode);
    walkBlockForArrows(ifStmt.thenBlock, sourceCode);
    if (ifStmt.elseBlock) walkBlockForArrows(ifStmt.elseBlock, sourceCode);
    return;
  }

  if (s.type === "while") {
    const w = stmt as unknown as WhileStatement;
    walkExprForArrows(w.condition as Expression, sourceCode);
    walkBlockForArrows(w.body, sourceCode);
    return;
  }

  if (s.type === "for") {
    const f = stmt as unknown as ForStatement;
    if (f.init) walkStmtForArrows(f.init as Statement, sourceCode);
    if (f.condition) walkExprForArrows(f.condition as Expression, sourceCode);
    if (f.update) walkExprForArrows(f.update as Expression, sourceCode);
    walkBlockForArrows(f.body, sourceCode);
    return;
  }

  if (s.type === "for_of") {
    const fo = stmt as unknown as ForOfStatement;
    if (fo.iterable) walkExprForArrows(fo.iterable as Expression, sourceCode);
    walkBlockForArrows(fo.body, sourceCode);
    return;
  }

  if (s.type === "try") {
    const t = stmt as unknown as TryStatement;
    walkBlockForArrows(t.tryBlock, sourceCode);
    if (t.catchBody) walkBlockForArrows(t.catchBody, sourceCode);
    if (t.finallyBlock) walkBlockForArrows(t.finallyBlock, sourceCode);
    return;
  }

  if (s.type === "switch") {
    const sw = stmt as unknown as SwitchStatement;
    walkExprForArrows(sw.discriminant as Expression, sourceCode);
    if (sw.cases) {
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as unknown as SwitchCase;
        if (c.consequent) walkStatementsForArrows(c.consequent, sourceCode);
      }
    }
    return;
  }

  if (s.type === "function") {
    const fn = stmt as unknown as FunctionNode;
    if (fn.body) walkBlockForArrows(fn.body, sourceCode);
    return;
  }
}

function walkBlockForArrows(body: BlockStatement, sourceCode: string): void {
  if (!body) return;
  if (body.statements) walkStatementsForArrows(body.statements as Statement[], sourceCode);
}

function walkStatementsForArrows(stmts: Statement[], sourceCode: string): void {
  for (let i = 0; i < stmts.length; i++) {
    walkStmtForArrows(stmts[i], sourceCode);
  }
}

export function checkArrowThisCapture(ast: AST, sourceCode: string): void {
  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i] as ClassNode;
    if (!cls.methods) continue;
    for (let j = 0; j < cls.methods.length; j++) {
      const method = cls.methods[j] as ClassMethod;
      if (method.body) {
        walkBlockForArrows(method.body, sourceCode);
      }
    }
  }

  if (ast.topLevelItems) {
    walkStatementsForArrows(ast.topLevelItems as Statement[], sourceCode);
  }

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i] as FunctionNode;
    if (fn.body) {
      walkBlockForArrows(fn.body, sourceCode);
    }
  }
}
