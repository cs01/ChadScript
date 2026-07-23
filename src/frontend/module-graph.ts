// Module ordering. A program is lowered into ONE module: every file's functions and classes are
// merged, and every file's top-level statements are concatenated into `main`. That concatenation
// is only correct if a file's statements run after the statements of everything it imports —
// otherwise an imported module-level `const` is read before it is initialized, which JavaScript
// would never do.
//
// So the file list handed to lowering is topologically sorted, dependencies first. Import cycles
// have no valid linear order at all, so they are rejected rather than approximated.

import ts from "typescript";
import { type Diagnostic, DiagnosticError } from "../diagnostics.js";
import { CODE } from "../validate/codes.js";
import { spanOf } from "../validate/validate.js";

// The source files a file imports from, in source order, restricted to files that are part of this
// program (a specifier resolving elsewhere is rejected by the validator's import-form rule).
function importsOf(sf: ts.SourceFile, checker: ts.TypeChecker): ts.SourceFile[] {
  const out: ts.SourceFile[] = [];
  for (const stmt of sf.statements) {
    const spec =
      ts.isImportDeclaration(stmt) || (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier)
        ? stmt.moduleSpecifier
        : undefined;
    if (!spec) continue;
    // The module specifier's symbol IS the imported source file's symbol; its declaration is the
    // SourceFile node. This resolves through tsc rather than re-implementing module resolution.
    const target = checker.getSymbolAtLocation(spec)?.declarations?.[0];
    if (target && ts.isSourceFile(target)) out.push(target);
  }
  return out;
}

// Depth-first post-order: a file is appended only after everything it imports. `onStack` catches
// cycles — the one graph shape with no valid initialization order.
export function orderModules(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): ts.SourceFile[] {
  const ordered: ts.SourceFile[] = [];
  const done = new Set<ts.SourceFile>();
  const onStack = new Set<ts.SourceFile>();
  const inProgram = new Set(sourceFiles);

  const visit = (sf: ts.SourceFile, from: ts.SourceFile): void => {
    if (done.has(sf)) return;
    if (onStack.has(sf)) {
      throw new DiagnosticError([cycleDiagnostic(sf, from)]);
    }
    onStack.add(sf);
    for (const dep of importsOf(sf, checker)) {
      if (inProgram.has(dep)) visit(dep, sf);
    }
    onStack.delete(sf);
    done.add(sf);
    ordered.push(sf);
  };

  for (const sf of sourceFiles) visit(sf, sf);
  return ordered;
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
