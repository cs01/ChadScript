// Module ordering and identity. A program is lowered into ONE module: every file's functions and
// classes are merged, and every file's top-level statements are concatenated into `main`. That
// concatenation is only correct if a file's statements run after the statements of everything it
// imports, otherwise an imported module-level `const` is read before it is initialized, which
// JavaScript would never do.
//
// So the file list handed to lowering is the set of modules Node would actually LOAD, starting at
// the entry and following runtime import edges, topologically sorted, dependencies first. Import
// cycles have no valid linear order at all, so they are rejected rather than approximated.

import ts from "typescript";
import { type Diagnostic, DiagnosticError, ice } from "../diagnostics.js";
import { CODE } from "../validate/codes.js";
import { spanOf } from "../validate/validate.js";

// The source files a file loads at runtime, in source order. `import type` / `export type ... from`
// are erased (verbatimModuleSyntax), so Node never loads their target; every other import form,
// including `import {} from`, does. A specifier resolving to a declaration file or an ambient
// module (`node:fs`) has no source to initialize; the validator decides whether it is allowed.
function runtimeImportsOf(sf: ts.SourceFile, checker: ts.TypeChecker): ts.SourceFile[] {
  const out: ts.SourceFile[] = [];
  for (const stmt of sf.statements) {
    let spec: ts.Expression | undefined;
    if (ts.isImportDeclaration(stmt) && !stmt.importClause?.isTypeOnly) {
      spec = stmt.moduleSpecifier;
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
      spec = stmt.moduleSpecifier;
    }
    if (!spec) continue;
    // The module specifier's symbol IS the imported source file's symbol; its declaration is the
    // SourceFile node. This resolves through tsc rather than re-implementing module resolution.
    const target = checker.getSymbolAtLocation(spec)?.declarations?.[0];
    if (target && ts.isSourceFile(target) && !target.isDeclarationFile) out.push(target);
  }
  return out;
}

// Depth-first post-order from the entry: a file is appended only after everything it imports.
// `onStack` catches cycles, the one graph shape with no valid initialization order.
export function orderModules(entry: ts.SourceFile, checker: ts.TypeChecker): ts.SourceFile[] {
  const ordered: ts.SourceFile[] = [];
  const done = new Set<ts.SourceFile>();
  const onStack = new Set<ts.SourceFile>();

  const visit = (sf: ts.SourceFile, from: ts.SourceFile): void => {
    if (done.has(sf)) return;
    if (onStack.has(sf)) {
      throw new DiagnosticError([cycleDiagnostic(sf, from)]);
    }
    onStack.add(sf);
    for (const dep of runtimeImportsOf(sf, checker)) visit(dep, sf);
    onStack.delete(sf);
    done.add(sf);
    ordered.push(sf);
  };

  visit(entry, entry);
  return ordered;
}

// Per-module namespace for top-level symbols whose generated names are derived from their SOURCE
// name (classes: `Point.method`, `Point.vtable`). Two modules may each declare `class Point`, so
// the name alone would collide. The entry keeps the bare name (readable IR); every other module
// gets `m<index>`, index = position among the program's source files, which is deterministic for
// a given program. Keyed by SourceFile identity, which is unique per loaded program.
const MODULE_IDS = new WeakMap<ts.SourceFile, string>();

export function assignModuleIds(sourceFiles: readonly ts.SourceFile[], entry: ts.SourceFile): void {
  sourceFiles.forEach((sf, i) => MODULE_IDS.set(sf, sf === entry ? "" : `m${i}`));
}

// "" for the entry module. Throws for a file that is not part of the loaded program (a declaration
// file, say): a class declared there has no generated code, so asking for its id is a bug.
export function moduleIdOf(sf: ts.SourceFile): string {
  const id = MODULE_IDS.get(sf);
  if (id === undefined) ice(`no module id for ${sf.fileName}`);
  return id;
}

function cycleDiagnostic(sf: ts.SourceFile, from: ts.SourceFile): Diagnostic {
  return {
    code: CODE.MODULE_FORM,
    message: `import cycle: \`${sf.fileName}\` is part of a circular import`,
    span: spanOf(from, from),
    suggestion:
      "module top-level statements run in dependency order, which a cycle has none of; " +
      "move the shared declarations into a third module both files import",
  };
}
