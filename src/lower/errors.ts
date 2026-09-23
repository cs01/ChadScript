// The builtin error classes: Error, TypeError, RangeError, SyntaxError. A value of any of these types
// is a pointer to a runtime CsThrown (runtime/errors.milo), the same thing a `catch` binding holds,
// so its ValueType is `unknown`. `new TypeError(m)`, `e.message`, `e.name`, `String(e)`,
// `e instanceof RangeError` and `throw e` work on it; everything else is rejected at validate.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import { type LowerCtx, lowerExpr, nameOf } from "./lower.js";
import { isSystemErrorType } from "./host-types.js";

// The runtime's ERR_* kinds (runtime/errors.milo); 0 is a thrown string.
export const ERROR_KINDS = {
  Error: 1,
  TypeError: 2,
  RangeError: 3,
  SyntaxError: 4,
} as const;
export type ErrorClass = keyof typeof ERROR_KINDS;
// A kind no CsThrown has: `e instanceof C` for a program class C tests against it (always false).
export const NO_ERROR_KIND = -1;

function isErrorClassName(name: string): name is ErrorClass {
  return Object.hasOwn(ERROR_KINDS, name);
}

// Declared only by TypeScript's own lib files (never by the program or stdlib/globals.d.ts).
function isLibSymbol(sym: ts.Symbol | undefined): boolean {
  const decls = sym?.declarations ?? [];
  return (
    decls.length > 0 &&
    decls.every((d) => {
      const f = d.getSourceFile();
      return f.isDeclarationFile && !f.fileName.endsWith("stdlib/globals.d.ts");
    })
  );
}

// The error class an instance type names (the `Error` interface, a `TypeError`), or null.
export function builtinErrorType(t: ts.Type): ErrorClass | null {
  // A SystemError (a network failure) is an Error the runtime made, with a `code` besides.
  if (isSystemErrorType(t)) return "Error";
  const sym = t.getSymbol();
  if (!sym || !isErrorClassName(sym.name) || !isLibSymbol(sym)) return null;
  return sym.name;
}

// The error class a constructor reference (`Error` in `new Error(m)` / `x instanceof Error`) names.
export function builtinErrorConstructor(
  e: ts.Expression,
  checker: ts.TypeChecker,
): ErrorClass | null {
  if (!ts.isIdentifier(e) || !isErrorClassName(e.text)) return null;
  return isLibSymbol(checker.getSymbolAtLocation(e)) ? e.text : null;
}

// Properties of an error the subset reads. `stack` is out (Node's is a trace of JS frames).
export const ERROR_PROPERTIES: ReadonlySet<string> = new Set(["message", "name"]);

// `new TypeError(m)`, or `TypeError(m)`, which constructs the same without `new`. A second
// argument (`{ cause }`) is evaluated by tsc's rules but not kept: `cause` is not readable here.
export function lowerNewError(
  ne: ts.NewExpression | ts.CallExpression,
  cls: ErrorClass,
  ctx: LowerCtx,
): HExpr {
  const arg = ne.arguments?.[0];
  return {
    kind: "newError",
    errorKind: ERROR_KINDS[cls],
    message: arg ? lowerExpr(arg, ctx) : null,
    type: VT.unknown,
  };
}

// A read of a caught value (declared `unknown`) where tsc narrowed it, or null for any other
// identifier. The slot always holds the CsThrown: narrowed to a string (`typeof e === "string"`,
// `e === "s"`), a thrown string is its message; narrowed to an error (`instanceof`) or to `{}` /
// `object` (`e !== null`), it is the CsThrown itself. validate/throw-rules.ts rejects the other
// narrowings (to a number, an array, ...), which a caught value can never have.
export function lowerNarrowedCaughtRead(ident: ts.Identifier, ctx: LowerCtx): HExpr | null {
  const sym = ctx.checker.getSymbolAtLocation(ident);
  if (!sym?.valueDeclaration || !isCaughtSymbol(sym, ctx.checker)) return null;
  const narrowed = ctx.checker.getTypeAtLocation(ident);
  if (narrowed.flags & ts.TypeFlags.Unknown) return null;
  const read: HExpr = { kind: "varRef", name: nameOf(ident, ctx), type: VT.unknown };
  if (!isStringType(narrowed)) return read;
  return { kind: "runtimeCall", fn: "cs_thrown_message", args: [read], type: VT.string };
}

// A variable whose declared type is `unknown`: a catch binding (the only `unknown` the subset has).
export function isCaughtSymbol(sym: ts.Symbol, checker: ts.TypeChecker): boolean {
  const decl = sym.valueDeclaration;
  if (!decl) return false;
  return (checker.getTypeOfSymbolAtLocation(sym, decl).flags & ts.TypeFlags.Unknown) !== 0;
}

// A string, or a union of string literals.
export function isStringType(t: ts.Type): boolean {
  const parts = t.isUnion() ? t.types : [t];
  return parts.every((p) => (p.flags & ts.TypeFlags.StringLike) !== 0);
}

export function lowerErrorProperty(recv: HExpr, name: string): HExpr {
  switch (name) {
    case "message":
      return { kind: "runtimeCall", fn: "cs_thrown_message", args: [recv], type: VT.string };
    case "name":
      return { kind: "runtimeCall", fn: "cs_thrown_name", args: [recv], type: VT.string };
    // Only a SystemError has one (validate/error-rules.ts admits it on that type alone).
    case "code":
      return { kind: "runtimeCall", fn: "cs_thrown_code", args: [recv], type: VT.string };
    default:
      return ice(`lower: error property .${name} is not in the subset`);
  }
}
