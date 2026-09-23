// Module namespaces as STATIC references. `import * as m from "./m"` (and a default import of a
// builtin such as `import fs from "node:fs"`, whose default is the module itself) binds a name to a
// module, not to a value. There is no module object at runtime: `m.x` is resolved by tsc to the
// symbol `x` exported by that module and lowered exactly like a direct reference to `x`. That is
// why a namespace used as a first-class value (`const n = m`) is rejected by the validator.
//
// Shared by the validator (which admits `m.x` only in these static positions) and lowering (which
// rewrites them), so the two agree on what a namespace access is.

import ts from "typescript";

// The module symbol `expr` names, when `expr` is an identifier bound to a module namespace.
export function namespaceModuleOf(expr: ts.Node, checker: ts.TypeChecker): ts.Symbol | null {
  if (!ts.isIdentifier(expr)) return null;
  const sym = checker.getSymbolAtLocation(expr);
  if (!sym || !(sym.flags & ts.SymbolFlags.Alias)) return null;
  const target = checker.getAliasedSymbol(sym);
  return target.flags & ts.SymbolFlags.ValueModule ? target : null;
}

// For `m.x` with `m` a module namespace: the `x` identifier, whose symbol tsc resolves to the
// exported declaration. null for every other property access.
export function namespaceMemberOf(node: ts.Node, checker: ts.TypeChecker): ts.Identifier | null {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.name)) return null;
  return namespaceModuleOf(node.expression, checker) ? node.name : null;
}

// The identifier that names a call's target: the callee itself for `f(...)`, or `f` for
// `m.f(...)` through a namespace. null for method calls and other callee shapes.
export function calleeIdentifier(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): ts.Identifier | null {
  if (ts.isIdentifier(call.expression)) return call.expression;
  return namespaceMemberOf(call.expression, checker);
}
