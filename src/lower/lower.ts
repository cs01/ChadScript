// The lower pass: tsc AST + TypeChecker → HIR. This is the ONLY module in the compiler that
// imports `typescript` and queries the checker (the frontend's job ends here). It stamps every
// HIR expression with a resolved ValueType so the backend never touches the checker.
//
// The validator has already admitted only in-subset constructs, so a shape we don't recognize
// here is an ICE (a validator/lower mismatch), not a user error.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import type { HModule, HStmt, HExpr, UnaryOp, BinaryOp } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";

export function lower(loaded: LoadedProgram): HModule {
  const statements: HStmt[] = [];
  for (const sf of loaded.sourceFiles) {
    for (const stmt of sf.statements) statements.push(...lowerStatement(stmt, loaded.checker));
  }
  return { statements };
}

// Returns an array because one `let a = 1, b = 2;` lowers to several varDecls.
function lowerStatement(stmt: ts.Statement, checker: ts.TypeChecker): HStmt[] {
  if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
    return [lowerCallStatement(stmt.expression, checker)];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.map((d) => lowerVarDecl(d, checker));
  }
  return ice(`lower: unsupported statement ${ts.SyntaxKind[stmt.kind]}`);
}

function lowerVarDecl(decl: ts.VariableDeclaration, checker: ts.TypeChecker): HStmt {
  if (!ts.isIdentifier(decl.name)) ice("lower: destructuring declarations not supported yet");
  if (!decl.initializer) ice("lower: variable declaration without initializer not supported yet");
  const init = lowerExpr(decl.initializer, checker);
  return { kind: "varDecl", name: decl.name.text, init, type: init.type };
}

function lowerCallStatement(call: ts.CallExpression, checker: ts.TypeChecker): HStmt {
  const target = calleeName(call.expression);
  const arg = call.arguments[0];
  if (call.arguments.length !== 1 || !arg) ice(`lower: ${target} expects exactly one argument`);

  switch (target) {
    case "console.log":
      return { kind: "consoleLog", value: lowerExpr(arg, checker) };
    case "process.exit":
      return { kind: "processExit", code: lowerExpr(arg, checker) };
    default:
      return ice(`lower: unsupported call ${target}`);
  }
}

function lowerExpr(expr: ts.Expression, checker: ts.TypeChecker): HExpr {
  const type = resolveType(expr, checker);
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
      return { kind: "varRef", name: (expr as ts.Identifier).text, type };

    case ts.SyntaxKind.ParenthesizedExpression:
      return lowerExpr((expr as ts.ParenthesizedExpression).expression, checker);

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const u = expr as ts.PrefixUnaryExpression;
      return {
        kind: "unary",
        op: unaryOp(u.operator),
        operand: lowerExpr(u.operand, checker),
        type,
      };
    }

    case ts.SyntaxKind.BinaryExpression: {
      const b = expr as ts.BinaryExpression;
      return {
        kind: "binary",
        op: binaryOp(b.operatorToken.kind),
        left: lowerExpr(b.left, checker),
        right: lowerExpr(b.right, checker),
        type,
      };
    }

    default:
      return ice(`lower: unsupported expression ${ts.SyntaxKind[expr.kind]}`);
  }
}

// The checker is the oracle: map its resolved type to our ValueType. Anything outside the
// currently-supported domain is an ICE (the validator should have rejected it upstream).
function resolveType(expr: ts.Expression, checker: ts.TypeChecker): ValueType {
  const flags = checker.getTypeAtLocation(expr).flags;
  if (flags & ts.TypeFlags.NumberLike) return VT.number;
  if (flags & ts.TypeFlags.StringLike) return VT.string;
  if (flags & ts.TypeFlags.BooleanLike) return VT.boolean;
  if (flags & ts.TypeFlags.Null) return VT.null;
  if (flags & ts.TypeFlags.Undefined) return VT.undefined;
  return ice(`lower: unsupported value type (flags ${flags}) at ${ts.SyntaxKind[expr.kind]}`);
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
