// CS1220 for the TypeScript default lib's global functions: default-DENY against what
// lower/globals.ts lowers. Without this, an unlowered one (isNaN before it was supported,
// encodeURIComponent) fell through to the user-function path and emitted a call to `@isNaN`.

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
