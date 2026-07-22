// The lower pass: tsc AST + TypeChecker → HIR. This is the ONLY module in the compiler that
// imports `typescript` and queries the checker (the frontend's job ends here). It stamps every
// HIR expression with a resolved ValueType so the backend never touches the checker.
//
// Names are RESOLVED to their tsc Symbol and given a unique HIR name here. Two different
// variables that share a source name (shadowing) get distinct HIR names, so the backend's flat
// binding map is correct by construction — no scope stack, and it stays correct for closures.
//
// The validator has already admitted only in-subset constructs, so a shape we don't recognize
// here is an ICE (a validator/lower mismatch), not a user error.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import type { HModule, HStmt, HExpr, UnaryOp, BinaryOp } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";

interface LowerCtx {
  checker: ts.TypeChecker;
  // Symbol identity → unique HIR name. Shadowing variables have distinct symbols, so distinct
  // names. Keyed by Symbol so a reference resolves to the same name as its declaration.
  names: Map<ts.Symbol, string>;
  counter: { n: number };
}

export function lower(loaded: LoadedProgram): HModule {
  const ctx: LowerCtx = { checker: loaded.checker, names: new Map(), counter: { n: 0 } };
  const statements: HStmt[] = [];
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) statements.push(...lowerStatement(stmt, ctx));
  }
  return { statements };
}

// The stable HIR name for the variable an identifier resolves to. Falls back to the source
// text keyed by position if the checker cannot produce a symbol (should not happen for the
// admitted subset), so distinct-but-symbolless names never collide.
function nameOf(ident: ts.Identifier, ctx: LowerCtx): string {
  const symbol = ctx.checker.getSymbolAtLocation(ident);
  if (!symbol) return ice(`lower: no symbol for identifier ${ident.text}`);
  let name = ctx.names.get(symbol);
  if (!name) {
    name = `${ident.text}.${ctx.counter.n++}`;
    ctx.names.set(symbol, name);
  }
  return name;
}

// Returns an array because one `let a = 1, b = 2;` lowers to several varDecls.
function lowerStatement(stmt: ts.Statement, ctx: LowerCtx): HStmt[] {
  if (ts.isExpressionStatement(stmt)) {
    if (ts.isCallExpression(stmt.expression)) return [lowerCallStatement(stmt.expression, ctx)];
    return [lowerExprStatement(stmt.expression, ctx)];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.map((d) => lowerVarDecl(d, ctx));
  }
  if (ts.isIfStatement(stmt)) {
    return [lowerIf(stmt, ctx)];
  }
  if (ts.isWhileStatement(stmt)) {
    return [
      {
        kind: "while",
        cond: lowerExpr(stmt.expression, ctx),
        body: lowerBranchBody(stmt.statement, ctx),
      },
    ];
  }
  if (ts.isForStatement(stmt)) {
    return [lowerFor(stmt, ctx)];
  }
  if (ts.isBlock(stmt)) {
    // A bare block just contributes its statements (flattened; scoping is enforced by tsc, and
    // shadowing is safe because names are symbol-unique).
    return lowerStatements(stmt.statements, ctx);
  }
  return ice(`lower: unsupported statement ${ts.SyntaxKind[stmt.kind]}`);
}

function lowerStatements(stmts: readonly ts.Statement[], ctx: LowerCtx): HStmt[] {
  return stmts.flatMap((s) => lowerStatement(s, ctx));
}

// The body of a branch is either a block (`{ ... }`) or a single statement (`if (c) x();`).
function lowerBranchBody(stmt: ts.Statement, ctx: LowerCtx): HStmt[] {
  return ts.isBlock(stmt) ? lowerStatements(stmt.statements, ctx) : lowerStatement(stmt, ctx);
}

function lowerIf(stmt: ts.IfStatement, ctx: LowerCtx): HStmt {
  return {
    kind: "if",
    cond: lowerExpr(stmt.expression, ctx),
    then: lowerBranchBody(stmt.thenStatement, ctx),
    otherwise: stmt.elseStatement ? lowerBranchBody(stmt.elseStatement, ctx) : null,
  };
}

function lowerFor(stmt: ts.ForStatement, ctx: LowerCtx): HStmt {
  let init: HStmt[] = [];
  if (stmt.initializer) {
    init = ts.isVariableDeclarationList(stmt.initializer)
      ? stmt.initializer.declarations.map((d) => lowerVarDecl(d, ctx))
      : [lowerExprStatement(stmt.initializer, ctx)];
  }
  const update = stmt.incrementor ? [lowerExprStatement(stmt.incrementor, ctx)] : [];
  return {
    kind: "for",
    init,
    cond: stmt.condition ? lowerExpr(stmt.condition, ctx) : null,
    update,
    body: lowerBranchBody(stmt.statement, ctx),
  };
}

// A statement-position expression whose value is discarded: assignment, compound assignment,
// or ++/-- (which we desugar to an assignment). Used for expression statements and for-clauses.
function lowerExprStatement(expr: ts.Expression, ctx: LowerCtx): HStmt {
  if (ts.isBinaryExpression(expr) && isAssignmentOp(expr.operatorToken.kind)) {
    return lowerAssignment(expr, ctx);
  }
  if (ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr)) {
    return lowerIncDec(expr, ctx);
  }
  return ice(`lower: unsupported expression statement ${ts.SyntaxKind[expr.kind]}`);
}

// `i++` / `i--` / `++i` / `--i` in statement position → `i = i +/- 1`. The pre/post distinction
// only matters for the produced value, which statement position discards.
function lowerIncDec(
  expr: ts.PostfixUnaryExpression | ts.PrefixUnaryExpression,
  ctx: LowerCtx,
): HStmt {
  const op = expr.operator;
  if (op !== ts.SyntaxKind.PlusPlusToken && op !== ts.SyntaxKind.MinusMinusToken) {
    // A prefix +/-/! in statement position has no effect and is pointless — reject upstream.
    return ice(`lower: unsupported unary statement operator ${ts.SyntaxKind[op]}`);
  }
  if (!ts.isIdentifier(expr.operand)) ice("lower: ++/-- only supported on a simple variable");
  const name = nameOf(expr.operand, ctx);
  const numberType = resolveType(expr.operand, ctx);
  return {
    kind: "assign",
    name,
    value: {
      kind: "binary",
      op: op === ts.SyntaxKind.PlusPlusToken ? "add" : "sub",
      left: { kind: "varRef", name, type: numberType },
      right: { kind: "numberLit", value: 1, type: numberType },
      type: numberType,
    },
  };
}

function lowerAssignment(expr: ts.BinaryExpression, ctx: LowerCtx): HStmt {
  if (!ts.isIdentifier(expr.left)) ice("lower: only simple `name = ...` assignment is supported");
  const left = expr.left as ts.Identifier;
  const name = nameOf(left, ctx);
  const op = expr.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsToken) {
    return { kind: "assign", name, value: lowerExpr(expr.right, ctx) };
  }
  // Compound assignment `name <op>= rhs` desugars to `name = name <op> rhs`. The value's type
  // matches the variable (numeric compound ops on a number stay a number).
  const value: HExpr = {
    kind: "binary",
    op: compoundOp(op),
    left: lowerExpr(left, ctx),
    right: lowerExpr(expr.right, ctx),
    type: resolveType(left, ctx),
  };
  return { kind: "assign", name, value };
}

function lowerVarDecl(decl: ts.VariableDeclaration, ctx: LowerCtx): HStmt {
  if (!ts.isIdentifier(decl.name)) ice("lower: destructuring declarations not supported yet");
  if (!decl.initializer) ice("lower: variable declaration without initializer not supported yet");
  const init = lowerExpr(decl.initializer, ctx);
  return { kind: "varDecl", name: nameOf(decl.name, ctx), init, type: init.type };
}

function lowerCallStatement(call: ts.CallExpression, ctx: LowerCtx): HStmt {
  const target = calleeName(call.expression);
  const arg = call.arguments[0];
  if (call.arguments.length !== 1 || !arg) ice(`lower: ${target} expects exactly one argument`);

  switch (target) {
    case "console.log":
      return { kind: "consoleLog", value: lowerExpr(arg, ctx) };
    case "process.exit":
      return { kind: "processExit", code: lowerExpr(arg, ctx) };
    default:
      return ice(`lower: unsupported call ${target}`);
  }
}

function lowerExpr(expr: ts.Expression, ctx: LowerCtx): HExpr {
  const type = resolveType(expr, ctx);
  switch (expr.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return { kind: "numberLit", value: Number((expr as ts.NumericLiteral).text), type };

    case ts.SyntaxKind.StringLiteral:
      return { kind: "stringLit", value: (expr as ts.StringLiteral).text, type };

    case ts.SyntaxKind.TrueKeyword:
      return { kind: "boolLit", value: true, type };

    case ts.SyntaxKind.FalseKeyword:
      return { kind: "boolLit", value: false, type };

    case ts.SyntaxKind.Identifier:
      // A bare identifier in expression position is a variable reference (callees like
      // console.log are handled separately in calleeName, never through lowerExpr).
      return { kind: "varRef", name: nameOf(expr as ts.Identifier, ctx), type };

    case ts.SyntaxKind.ParenthesizedExpression:
      return lowerExpr((expr as ts.ParenthesizedExpression).expression, ctx);

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const u = expr as ts.PrefixUnaryExpression;
      return { kind: "unary", op: unaryOp(u.operator), operand: lowerExpr(u.operand, ctx), type };
    }

    case ts.SyntaxKind.BinaryExpression: {
      const b = expr as ts.BinaryExpression;
      return {
        kind: "binary",
        op: binaryOp(b.operatorToken.kind),
        left: lowerExpr(b.left, ctx),
        right: lowerExpr(b.right, ctx),
        type,
      };
    }

    default:
      return ice(`lower: unsupported expression ${ts.SyntaxKind[expr.kind]}`);
  }
}

// The checker is the oracle: map its resolved type to our ValueType. Anything outside the
// currently-supported domain is an ICE (the validator should have rejected it upstream).
function resolveType(expr: ts.Expression, ctx: LowerCtx): ValueType {
  const flags = ctx.checker.getTypeAtLocation(expr).flags;
  if (flags & ts.TypeFlags.NumberLike) return VT.number;
  if (flags & ts.TypeFlags.StringLike) return VT.string;
  if (flags & ts.TypeFlags.BooleanLike) return VT.boolean;
  if (flags & ts.TypeFlags.Null) return VT.null;
  if (flags & ts.TypeFlags.Undefined) return VT.undefined;
  return ice(`lower: unsupported value type (flags ${flags}) at ${ts.SyntaxKind[expr.kind]}`);
}

function isAssignmentOp(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken
  );
}

function compoundOp(kind: ts.SyntaxKind): BinaryOp {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken:
      return "add";
    case ts.SyntaxKind.MinusEqualsToken:
      return "sub";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "mul";
    case ts.SyntaxKind.SlashEqualsToken:
      return "div";
    case ts.SyntaxKind.PercentEqualsToken:
      return "rem";
    default:
      return ice(`lower: unsupported compound assignment ${ts.SyntaxKind[kind]}`);
  }
}

function unaryOp(op: ts.PrefixUnaryOperator): UnaryOp {
  switch (op) {
    case ts.SyntaxKind.MinusToken:
      return "neg";
    case ts.SyntaxKind.PlusToken:
      return "pos";
    default:
      return ice(`lower: unsupported unary operator ${ts.SyntaxKind[op]}`);
  }
}

function binaryOp(kind: ts.SyntaxKind): BinaryOp {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return "add";
    case ts.SyntaxKind.MinusToken:
      return "sub";
    case ts.SyntaxKind.AsteriskToken:
      return "mul";
    case ts.SyntaxKind.SlashToken:
      return "div";
    case ts.SyntaxKind.PercentToken:
      return "rem";
    case ts.SyntaxKind.LessThanToken:
      return "lt";
    case ts.SyntaxKind.GreaterThanToken:
      return "gt";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "le";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return "ge";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "eq";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "ne";
    default:
      return ice(`lower: unsupported binary operator ${ts.SyntaxKind[kind]}`);
  }
}

// "console.log" / "process.exit" for a property-access callee; bare name otherwise.
function calleeName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return `<${ts.SyntaxKind[expr.kind]}>`;
}
