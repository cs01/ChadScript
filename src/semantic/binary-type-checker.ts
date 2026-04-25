import type {
  AST,
  Expression,
  BinaryNode,
  VariableNode,
  UnaryNode,
  VariableDeclaration,
  AssignmentStatement,
  FunctionNode,
  ClassNode,
  ClassMethod,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  ReturnStatement,
  ThrowStatement,
  BlockStatement,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

function inferBinaryExprType(expr: Expression): string {
  if (!expr) return "unknown";
  const t = expr.type;
  if (t === "number") return "number";
  if (t === "string") return "string";
  if (t === "boolean") return "boolean";
  if (t === "null") return "null";
  if (t === "undefined") return "null";
  if (t === "array") return "array";
  if (t === "object") return "object";
  if (t === "new") return "object";
  if (t === "template_literal") return "string";
  if (t === "regex") return "object";

  if (t === "variable") {
    const v = expr as VariableNode;
    if (v.name === "NaN") return "number";
    if (v.name === "Infinity") return "number";
    return "unknown";
  }

  if (t === "unary") {
    const u = expr as UnaryNode;
    if (u.op === "!") return "boolean";
    if (u.op === "-") return "number";
    if (u.op === "+") return "number";
    if (u.op === "~") return "number";
    if (u.op === "typeof") return "string";
    return "unknown";
  }

  if (t === "binary") {
    const b = expr as BinaryNode;
    const op = b.op;
    if (op === "===" || op === "!==" || op === "<" || op === ">") return "boolean";
    if (op === "-" || op === "*" || op === "/" || op === "%") return "number";
    if (op === "+") {
      const lt = inferBinaryExprType(b.left);
      if (lt === "string") return "string";
      const rt = inferBinaryExprType(b.right);
      if (rt === "string") return "string";
      if (lt === "number" && rt === "number") return "number";
    }
    return "unknown";
  }

  return "unknown";
}

function validateBinaryOp(b: BinaryNode, sourceCode: string): void {
  const lt = inferBinaryExprType(b.left);
  const rt = inferBinaryExprType(b.right);
  if (lt === "unknown" || rt === "unknown") return;

  const op = b.op;
  if (op === "===" || op === "!==" || op === "==" || op === "!=") return;
  if (op === "&&" || op === "||" || op === "??") return;

  if (op === "+") {
    if (lt === "string" || rt === "string") return;
    if (lt === "number" && rt === "number") return;
    const output = formatCompileError(
      sourceCode,
      "cannot use '+' between '" + lt + "' and '" + rt + "'",
      b.loc,
      "use explicit conversion if intended",
      [],
    );
    process.stderr.write(output);
    process.exit(1);
    return;
  }

  if (op === "-" || op === "*" || op === "/" || op === "%") {
    if (lt === "number" && rt === "number") return;
    const output = formatCompileError(
      sourceCode,
      "cannot use '" + op + "' between '" + lt + "' and '" + rt + "'",
      b.loc,
      "arithmetic operators require both operands to be numbers",
      [],
    );
    process.stderr.write(output);
    process.exit(1);
    return;
  }
}

function checkBinaryInExpr(expr: Expression, sourceCode: string): void {
  if (!expr) return;
  if (expr.type === "binary") {
    const b = expr as BinaryNode;
    checkBinaryInExpr(b.left, sourceCode);
    checkBinaryInExpr(b.right, sourceCode);
    validateBinaryOp(b, sourceCode);
  }
}

function checkVarDeclBinary(decl: VariableDeclaration, sourceCode: string): void {
  if (decl.value) {
    checkBinaryInExpr(decl.value as Expression, sourceCode);
  }
}

function checkAssignBinary(assign: AssignmentStatement, sourceCode: string): void {
  checkBinaryInExpr(assign.value, sourceCode);
}

function walkStmt(stmt: object, src: string): void {
  if (!stmt) return;
  const stype = (stmt as { type: string }).type;
  if (stype === "variable_declaration") {
    checkVarDeclBinary(stmt as VariableDeclaration, src);
  } else if (stype === "assignment") {
    checkAssignBinary(stmt as AssignmentStatement, src);
  } else if (stype === "return") {
    const r = stmt as ReturnStatement;
    if (r.value) checkBinaryInExpr(r.value as Expression, src);
  } else if (stype === "throw") {
    checkBinaryInExpr((stmt as ThrowStatement).argument, src);
  } else if (stype === "if") {
    const i = stmt as IfStatement;
    checkBinaryInExpr(i.condition, src);
    walkBlock(i.thenBlock, src);
    if (i.elseBlock) walkBlock(i.elseBlock, src);
  } else if (stype === "while") {
    const w = stmt as WhileStatement;
    checkBinaryInExpr(w.condition, src);
    walkBlock(w.body, src);
  } else if (stype === "do_while") {
    const d = stmt as DoWhileStatement;
    walkBlock(d.body, src);
    checkBinaryInExpr(d.condition, src);
  } else if (stype === "for") {
    const f = stmt as ForStatement;
    if (f.init) walkStmt(f.init, src);
    if (f.condition) checkBinaryInExpr(f.condition, src);
    if (f.update) {
      if ((f.update as { type: string }).type === "assignment") walkStmt(f.update, src);
      else checkBinaryInExpr(f.update as Expression, src);
    }
    walkBlock(f.body, src);
  } else if (stype === "for_of") {
    const fo = stmt as ForOfStatement;
    checkBinaryInExpr(fo.iterable, src);
    walkBlock(fo.body, src);
  } else if (stype === "try") {
    const t = stmt as TryStatement;
    walkBlock(t.tryBlock, src);
    if (t.catchBody) walkBlock(t.catchBody, src);
    if (t.finallyBlock) walkBlock(t.finallyBlock, src);
  } else if (stype === "switch") {
    const sw = stmt as SwitchStatement;
    checkBinaryInExpr(sw.discriminant, src);
    let ci = 0;
    while (ci < sw.cases.length) {
      const c = sw.cases[ci];
      if (c.test) checkBinaryInExpr(c.test as Expression, src);
      walkStmts(c.consequent, src);
      ci = ci + 1;
    }
  } else if (stype === "block") {
    walkBlock(stmt as BlockStatement, src);
  } else if (stype === "binary") {
    checkBinaryInExpr(stmt as unknown as Expression, src);
  }
}

function walkStmts(stmts: unknown[], src: string): void {
  let i = 0;
  while (i < stmts.length) {
    walkStmt(stmts[i] as object, src);
    i = i + 1;
  }
}

function walkBlock(block: BlockStatement, src: string): void {
  walkStmts(block.statements, src);
}

export function checkBinaryTypes(ast: AST, sourceCode: string): void {
  const items = ast.topLevelItems;
  if (items) walkStmts(items as unknown[], sourceCode);
  let fi = 0;
  while (fi < ast.functions.length) {
    const fn = ast.functions[fi] as FunctionNode;
    walkBlock(fn.body, sourceCode);
    fi = fi + 1;
  }
  let ci = 0;
  while (ci < ast.classes.length) {
    const cls = ast.classes[ci] as ClassNode;
    let mi = 0;
    while (mi < cls.methods.length) {
      const m = cls.methods[mi] as ClassMethod;
      walkBlock(m.body, sourceCode);
      mi = mi + 1;
    }
    ci = ci + 1;
  }
}
