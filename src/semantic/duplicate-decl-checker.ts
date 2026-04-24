import type { AST, SourceLocation } from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkDuplicateDeclarations(ast: AST, sourceCode: string): void {
  const importedNames = new Set<string>();
  for (let i = 0; i < ast.imports.length; i++) {
    const imp = ast.imports[i];
    for (let j = 0; j < imp.specifiers.length; j++) {
      const spec = imp.specifiers[j];
      if (spec.startsWith("* as ")) {
        importedNames.add(spec.substring(5));
      } else {
        importedNames.add(spec);
      }
    }
    if (imp.defaultImport) {
      importedNames.add(imp.defaultImport);
    }
  }

  const seen = new Map<string, { kind: string; loc?: SourceLocation }>();

  for (let i = 0; i < ast.functions.length; i++) {
    const fn = ast.functions[i];
    if (fn.declare) continue;
    const name = fn.name;
    if (importedNames.has(name)) continue;
    const existing = seen.get(name);
    if (existing) {
      reportDuplicate(sourceCode, name, existing.kind, "function", fn.loc);
    }
    seen.set(name, { kind: "function", loc: fn.loc });
  }

  for (let i = 0; i < ast.topLevelStatements.length; i++) {
    const stmt = ast.topLevelStatements[i];
    if (stmt.type !== "variable_declaration") continue;
    if (stmt.value === null) continue;
    const name = stmt.name;
    if (importedNames.has(name)) continue;
    const existing = seen.get(name);
    if (existing) {
      reportDuplicate(sourceCode, name, existing.kind, stmt.kind, stmt.loc);
    }
    seen.set(name, { kind: stmt.kind, loc: stmt.loc });
  }
}

function reportDuplicate(
  sourceCode: string,
  name: string,
  firstKind: string,
  secondKind: string,
  loc?: SourceLocation,
): void {
  const output = formatCompileError(
    sourceCode,
    "duplicate module-level declaration '" + name + "'",
    loc,
    "rename one of the declarations to avoid LLVM symbol collision",
    [
      "first declared as " + firstKind,
      "ChadScript merges all files into one flat module — names must be unique across all source files",
    ],
  );
  process.stderr.write(output);
  process.exit(1);
}
