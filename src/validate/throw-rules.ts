// What may be thrown, and what a caught value may be used in. A thrown value is a runtime CsThrown
// (runtime/errors.milo), which holds a string or one of the built-in errors, so:
//   - `throw x` needs x to be a string, an error, or a caught value re-thrown (CS1247); a number,
//     an object or a class instance would need a CsThrown that can hold any value;
//   - `&&`, `||` and `??` on a caught value (tsc's `unknown`) are refused (CS1248): their result is
//     `unknown` or `{}`, a type that is neither a string nor an error and has no representation;
//   - so is a read of a caught value where a test narrowed it to something no thrown value is (a
//     number after `typeof e === "number"`, an array after `Array.isArray(e)`): the branch is dead
//     in Node, and the value has no such representation to be read as.
// Everything else tsc allows on a caught value (typeof, ===, switch, truthiness, String(),
// Number(), instanceof) follows the thrown value at run time (codegen/errors.ts).

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { builtinErrorType, isCaughtSymbol, isStringType } from "../lower/errors.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";

export function checkThrowUse(node: ts.Node, hit: Hit, checker: ts.TypeChecker): Diagnostic | null {
  if (ts.isThrowStatement(node)) {
    const t = checker.getTypeAtLocation(node.expression);
    if (isThrowable(t)) return null;
    return hit(
      CODE.THROWN_VALUE,
      `throwing a \`${checker.typeToString(t)}\` is not supported: only a string, an Error ` +
        "(Error, TypeError, RangeError, SyntaxError) or a caught value can be thrown",
      "throw an error that describes it, for example `throw new Error(String(x))`, and keep any " +
        "extra data in a variable of its own",
    );
  }
  if (
    ts.isBinaryExpression(node) &&
    LOGICAL.has(node.operatorToken.kind) &&
    (isCaughtType(checker.getTypeAtLocation(node.left)) ||
      isCaughtType(checker.getTypeAtLocation(node.right)))
  ) {
    const op = ts.tokenToString(node.operatorToken.kind);
    return hit(
      CODE.CAUGHT_VALUE_USE,
      `\`${op}\` on a caught value is not supported: its result has no type ChadScript can hold`,
      'test the value first (`e instanceof Error`, `typeof e === "string"`), or convert it: ' +
        '`String(e) || "default"`',
    );
  }
  if (ts.isIdentifier(node)) {
    const sym = checker.getSymbolAtLocation(node);
    if (!sym || !isCaughtSymbol(sym, checker)) return null;
    // The binding holds the thrown record; a new value of another kind has no place in it.
    let at: ts.Node = node;
    while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
    const p = at.parent;
    if (
      ts.isBinaryExpression(p) &&
      p.left === at &&
      p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      return hit(
        CODE.CAUGHT_VALUE_USE,
        `assigning to the caught value \`${node.text}\` is not supported`,
        `keep the new value in a variable of its own: \`let message = String(${node.text})\``,
      );
    }
    const t = checker.getTypeAtLocation(node);
    if (isCaughtType(t) || isStringType(t) || builtinErrorType(t) !== null || isOpaqueObject(t)) {
      return null;
    }
    return hit(
      CODE.CAUGHT_VALUE_USE,
      `\`${node.text}\` is read here as a \`${checker.typeToString(t)}\`, which a caught value ` +
        "never is: only a string or an Error can be thrown",
      'test for what can be thrown instead: `typeof e === "string"` or `e instanceof Error`',
    );
  }
  return null;
}

// `{}`, `object`, `{} | null` or `{} | undefined`: what `e !== null` and similar tests narrow a
// caught value to. Its value is still the caught value, and nothing but tests and conversions
// apply to it. (Narrowed to exactly `null` or `undefined`, it is a dead read that is refused.)
function isOpaqueObject(t: ts.Type): boolean {
  const parts = t.isUnion() ? t.types : [t];
  const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined;
  if (parts.every((p) => (p.flags & nullish) !== 0)) return false;
  return parts.every(
    (p) =>
      (p.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.NonPrimitive)) !== 0 ||
      ((p.flags & ts.TypeFlags.Object) !== 0 &&
        p.getProperties().length === 0 &&
        p.getCallSignatures().length === 0 &&
        p.getConstructSignatures().length === 0),
  );
}

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

// tsc types a `catch (e)` binding (and a rejection reason) `unknown`.
function isCaughtType(t: ts.Type): boolean {
  return (t.flags & ts.TypeFlags.Unknown) !== 0;
}

// A string (every member of a literal union too), an error, or a caught value.
function isThrowable(t: ts.Type): boolean {
  return isCaughtType(t) || builtinErrorType(t) !== null || isStringType(t);
}
