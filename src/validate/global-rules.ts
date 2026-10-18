// Rules for the ambient globals that have no lowering of their own to fall back on: the TypeScript
// default lib's global functions (CS1220, default-DENY against what lower/globals.ts lowers;
// before this, an unlowered one such as isNaN emitted a call to `@isNaN`) and `process.exitCode`.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";
import type { Hit } from "./type-rules.js";

export function checkLibGlobalCall(
  node: ts.CallExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  const name = defaultLibFunctionName(node, checker);
  if (name === null || LIB_GLOBAL_FUNCTIONS.has(name)) return null;
  return hit(
    CODE.STDLIB_STATIC,
    `the global \`${name}\` is not supported yet`,
    `supported global functions: ${[...LIB_GLOBAL_FUNCTIONS].join(", ")}`,
  );
}

// The default-lib global functions lower/globals.ts lowers (String/Number/Boolean are `var`
// declarations in lib, not functions, so they never reach this check).
const LIB_GLOBAL_FUNCTIONS: ReadonlySet<string> = new Set([
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
]);

// The name of the default-lib `function` a bare identifier call resolves to, or null. Our own
// ambient environment (stdlib/globals.d.ts) is not the default lib and has its own rules.
function defaultLibFunctionName(node: ts.CallExpression, checker: ts.TypeChecker): string | null {
  if (!ts.isIdentifier(node.expression)) return null;
  const decls = checker.getSymbolAtLocation(node.expression)?.declarations ?? [];
  if (decls.length === 0 || !decls.every(ts.isFunctionDeclaration)) return null;
  const file = decls[0]!.getSourceFile();
  if (!file.isDeclarationFile || file.fileName.endsWith("stdlib/globals.d.ts")) return null;
  return node.expression.text;
}

// `process.exitCode = n;` as a statement, where tsc knows n is one integer (a literal, or a const
// holding one). Node throws a RangeError for a non-integer and reads back `undefined` before the
// first write; neither is modeled, so every other form is rejected.
export function checkProcessExitCode(
  pa: ts.PropertyAccessExpression,
  hit: Hit,
  checker: ts.TypeChecker,
): Diagnostic | null {
  if (!ts.isIdentifier(pa.expression) || pa.expression.text !== "process") return null;
  if (pa.name.text !== "exitCode") return null;
  const p = pa.parent;
  const isStatementWrite =
    ts.isBinaryExpression(p) &&
    p.left === pa &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isExpressionStatement(p.parent);
  if (!isStatementWrite) {
    return hit(
      CODE.NOT_IN_SUBSET,
      "`process.exitCode` is only supported as `process.exitCode = <integer>;`",
      "keep the code in a variable of your own and assign it once: `process.exitCode = 2;`",
    );
  }
  const t = checker.getTypeAtLocation(p.right);
  if (!t.isNumberLiteral() || !Number.isInteger(t.value)) {
    return hit(
      CODE.NOT_IN_SUBSET,
      "`process.exitCode` must be assigned an integer whose value is known at compile time",
      "assign a literal or a `const` holding one (`const EXIT_USAGE = 2;`); Node throws a RangeError for a non-integer",
    );
  }
  return null;
}
