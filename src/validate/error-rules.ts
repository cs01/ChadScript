// Builtin classes at validate: what the program may do with an Error (lower/errors.ts), which
// library classes it may construct with `new`, and that no class extends a library class.
//   - an Error is read through `.message` and `.name` only (`.stack` is a trace of Node's JS frames);
//     nothing is written to it and no method is called on it;
//   - `new` builds the program's own classes, Map, Set, Promise and the error classes;
//   - `class X extends Error` (or Map, Array, ...) would need an object that is both one of the
//     program's records and the runtime's error / collection, which neither representation is.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";
import { ERROR_PROPERTIES, builtinErrorType } from "../lower/errors.js";
import { isSystemErrorType } from "../lower/host-types.js";

const ERROR_CLASSES = new Set(["Error", "TypeError", "RangeError", "SyntaxError"]);

// Library classes `new` may construct (besides the error classes, recognized by lower/errors.ts).
const CONSTRUCTIBLE = new Set([
  "Map",
  "Set",
  "Promise",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
]);

export function checkBuiltinClassUse(
  node: ts.Node,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (ts.isPropertyAccessExpression(node)) {
    const cls = builtinErrorType(checker.getTypeAtLocation(node.expression));
    if (cls === null) return null;
    const name = node.name.text;
    const p = node.parent;
    if (ts.isCallExpression(p) && p.expression === node) {
      return hit(
        CODE.NOT_IN_SUBSET,
        `calling \`.${name}()\` on an error is not supported`,
        "use `String(e)` for its text, or read `e.message` / `e.name`",
      );
    }
    if (isWriteTarget(node)) {
      return hit(
        CODE.NOT_IN_SUBSET,
        `assigning to \`.${name}\` of an error is not supported`,
        "create a new error with the text you want: `new Error(message)`",
      );
    }
    const systemCode =
      name === "code" && isSystemErrorType(checker.getTypeAtLocation(node.expression));
    if (!ERROR_PROPERTIES.has(name) && !systemCode) {
      return hit(
        CODE.NOT_IN_SUBSET,
        `\`.${name}\` of an error is not supported (only \`.message\` and \`.name\` are)`,
        name === "stack"
          ? "a native program has no JavaScript stack trace; print `String(e)` or `e.message`"
          : "read `e.message` or `e.name`, or keep the extra data in a variable of its own",
      );
    }
    return null;
  }

  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text;
    if (!isLibraryValue(node.expression, checker) || CONSTRUCTIBLE.has(name)) return null;
    // Function and Date have their own codes (rules.ts checkNew).
    if (name === "Function" || name === "Date") return null;
    return hit(
      CODE.NOT_IN_SUBSET,
      `\`new ${name}\` is not supported`,
      "the compiler constructs your own classes, Map, Set, Promise and the Error classes; use " +
        "an array or one of those instead",
    );
  }

  // `x instanceof Map` / `p instanceof Error` for a record: only an error or a caught value is
  // tested against a built-in class.
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    ts.isIdentifier(node.right) &&
    isLibraryValue(node.right, checker)
  ) {
    const name = node.right.text;
    const left = checker.getTypeAtLocation(node.left);
    const leftIsError =
      (left.flags & ts.TypeFlags.Unknown) !== 0 || builtinErrorType(left) !== null;
    if (!ERROR_CLASSES.has(name) || !leftIsError) {
      return hit(
        CODE.NOT_IN_SUBSET,
        `\`instanceof ${name}\` is only supported for testing a caught value or an error ` +
          "against Error, TypeError, RangeError or SyntaxError",
        "test what the static type already says (`Array.isArray(x)`, a `kind` field), or " +
          "`instanceof` one of your own classes",
      );
    }
  }

  if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ExtendsKeyword) {
    const cls = node.parent;
    if (!ts.isClassLike(cls)) return null;
    for (const t of node.types) {
      if (!ts.isIdentifier(t.expression) || !isLibraryValue(t.expression, checker)) continue;
      const base = t.expression.text;
      return hit(
        CODE.NOT_IN_SUBSET,
        `a class that extends the built-in \`${base}\` is not supported`,
        base.endsWith("Error")
          ? "throw a built-in error (`throw new Error(msg)`, TypeError, RangeError) and keep extra " +
              "data in a variable of its own, or return a result object instead of throwing"
          : `keep a \`${base}\` in a field of your own class instead of extending it`,
      );
    }
  }
  return null;
}

// Declared by a library file (TypeScript's lib or stdlib/globals.d.ts), not by the program.
function isLibraryValue(id: ts.Identifier, checker: ts.TypeChecker): boolean {
  const sym = checker.getSymbolAtLocation(id);
  const decls = sym?.declarations ?? [];
  return decls.length > 0 && decls.every((d) => d.getSourceFile().isDeclarationFile);
}

function isWriteTarget(node: ts.Expression): boolean {
  const p = node.parent;
  if (ts.isBinaryExpression(p) && p.left === node) {
    const k = p.operatorToken.kind;
    return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
  }
  return (
    (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
    (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)
  );
}
