// Default exports. tsc binds a module's default export to a symbol named `default`; importers'
// aliases resolve to it (or, for `export default <identifier>`, straight through to that binding),
// so a default export needs no machinery beyond giving that symbol storage when it has none.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HStmt } from "../hir/nodes.js";
import { type LowerCtx, lowerExpr, nameForSymbol, coerceToTarget } from "./lower.js";
import { valueTypeOfTsType } from "./type-translation.js";

// The `default` export symbol of the module `sf`.
export function defaultExportSymbol(sf: ts.SourceFile, checker: ts.TypeChecker): ts.Symbol {
  const moduleSym = checker.getSymbolAtLocation(sf);
  const sym = moduleSym
    ? checker.getExportsOfModule(moduleSym).find((s) => s.escapedName === "default")
    : undefined;
  return sym ?? ice(`lower: ${sf.fileName} has no default export symbol`);
}

// The symbol a function declaration binds. `export default function () {}` has no name to ask the
// checker about; its symbol is the module's `default` export, which is what importers resolve to.
export function functionDeclSymbol(decl: ts.FunctionDeclaration, ctx: LowerCtx): ts.Symbol {
  if (decl.name) {
    return (
      ctx.checker.getSymbolAtLocation(decl.name) ?? ice(`lower: no symbol for ${decl.name.text}`)
    );
  }
  return defaultExportSymbol(decl.getSourceFile(), ctx.checker);
}

// `export default <expression>` at module top level. An identifier operand makes `default` an
// ALIAS of that binding (the validator admits only immutable ones, where alias and the spec's
// value snapshot agree), so there is nothing to emit. Any other expression is a fresh module-level
// constant, evaluated here, in module initialization order, like a `const` declaration.
export function lowerDefaultExport(stmt: ts.ExportAssignment, ctx: LowerCtx): HStmt[] {
  if (stmt.isExportEquals) return ice("lower: `export =` reached lowering (tsc rejects it)");
  const sym = defaultExportSymbol(stmt.getSourceFile(), ctx.checker);
  if (sym.flags & ts.SymbolFlags.Alias) return [];
  const type = valueTypeOfTsType(
    ctx.checker.getTypeOfSymbolAtLocation(sym, stmt),
    stmt,
    ctx.checker,
  );
  const init = coerceToTarget(lowerExpr(stmt.expression, ctx), type);
  return [{ kind: "varDecl", name: nameForSymbol(sym, "default", ctx), init, type }];
}
