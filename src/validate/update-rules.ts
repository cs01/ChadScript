// `x++` / `--x` whose VALUE is used (`() => n++`, `a[i++]`). Statement position is an ordinary
// assignment on any variable, field or element; value position is admitted only on a number
// variable, which lowers to one load, add and store (HIR `update`).

import ts from "typescript";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";

function isStatementPosition(
  node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
  checker: ts.TypeChecker,
): boolean {
  let at: ts.Node = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const p = at.parent;
  if (ts.isExpressionStatement(p)) return true;
  if (ts.isForStatement(p) && p.incrementor === at) return true;
  // A void arrow's expression body is lowered as a statement, its value discarded.
  if (ts.isArrowFunction(p) && p.body === at) {
    const sig = checker.getSignatureFromDeclaration(p);
    const ret = sig ? checker.getReturnTypeOfSignature(sig) : undefined;
    return ret !== undefined && (ret.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0;
  }
  return false;
}

// An assignment (`=`, `+=`, ...) whose VALUE is used. Statement position (and a for-clause) is the
// normal form. As an arrow's expression body (`(d) => (text += d)`) its value is read back from the
// target (lower/declarations.ts lowerUpdateBody), so the target must be a name or `name.field`,
// which read back without re-running anything. Anywhere else (`f(x = 1)`) it is rejected.
export function assignmentValueProblem(node: ts.BinaryExpression): string | null {
  const k = node.operatorToken.kind;
  if (k < ts.SyntaxKind.FirstAssignment || k > ts.SyntaxKind.LastAssignment) return null;
  let at: ts.Node = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const p = at.parent;
  if (ts.isExpressionStatement(p)) return null;
  if (ts.isForStatement(p) && (p.incrementor === at || p.initializer === at)) return null;
  if (ts.isArrowFunction(p) && p.body === at) {
    const t = node.left;
    const simple =
      ts.isIdentifier(t) ||
      (ts.isPropertyAccessExpression(t) &&
        (ts.isIdentifier(t.expression) || t.expression.kind === ts.SyntaxKind.ThisKeyword));
    return simple
      ? null
      : "an arrow body that assigns to an element is only supported as a statement";
  }
  return "an assignment used as a value is not supported";
}

// Why this update cannot be lowered, or null when it can.
export function updateValueProblem(
  node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
  checker: ts.TypeChecker,
): string | null {
  const op = node.operator;
  if (op !== ts.SyntaxKind.PlusPlusToken && op !== ts.SyntaxKind.MinusMinusToken) return null;
  if (isStatementPosition(node, checker)) return null;
  if (!ts.isIdentifier(node.operand)) {
    return "`++`/`--` on a field or element is only supported as a statement";
  }
  const sym = checker.getSymbolAtLocation(node.operand);
  const decl = sym?.valueDeclaration;
  if (!sym || !decl) return "`++`/`--` needs a declared variable";
  try {
    const t = valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(sym, decl), decl, checker);
    if (t.kind === "number") return null;
  } catch (e) {
    if (!(e instanceof UnrepresentableTypeError)) throw e;
  }
  return "`++`/`--` whose value is used is only supported on a `number` variable";
}
