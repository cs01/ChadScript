import type {
  AST,
  Expression,
  BinaryNode,
  VariableNode,
  UnaryNode,
  VariableDeclaration,
  AssignmentStatement,
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

export function checkBinaryTypes(ast: AST, sourceCode: string): void {
  const items = ast.topLevelItems;
  if (!items) return;
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item) {
      const s = item as { type: string };
      const stype = s.type;
      if (stype === "variable_declaration") {
        checkVarDeclBinary(item as VariableDeclaration, sourceCode);
      } else if (stype === "assignment") {
        checkAssignBinary(item as AssignmentStatement, sourceCode);
      } else if (stype === "binary") {
        checkBinaryInExpr(item as unknown as Expression, sourceCode);
      }
    }
    i = i + 1;
  }
}
