// Frontend step 1: load a user program through the real TypeScript compiler and enforce the
// zero-diagnostic gate. If tsc reports ANY error under our locked strict options, the
// program is rejected before the validator ever runs — tsc is the type oracle, and an
// un-typecheckable program has no trustworthy types for us to lower.

import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Diagnostic, type Span, DiagnosticError, ice } from "../diagnostics.js";
import { USER_COMPILER_OPTIONS } from "./user-options.js";
import { assignModuleIds, orderModules } from "./module-graph.js";
import { moduleFormDiagnostic } from "./module-diagnostics.js";

// The ambient global environment injected into every user program (console, process, ...).
const GLOBALS_DTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "stdlib",
  "globals.d.ts",
);

export interface LoadedProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  // Every TypeScript source in the program (user files and `.ts` packages under node_modules; no
  // declaration files). All of them are validated, including files reached only by `import type`.
  sourceFiles: ts.SourceFile[];
  // The modules Node actually loads, starting at the entry, topologically ordered: a file always
  // follows everything it imports. Lowering concatenates their top-level statements into `main`,
  // so this order IS module initialization order.
  initOrder: ts.SourceFile[];
}

// Load + typecheck `entryFile`. Throws DiagnosticError with CS0001 for each tsc diagnostic.
export function loadProgram(entryFile: string): LoadedProgram {
  const program = ts.createProgram({
    rootNames: [GLOBALS_DTS, entryFile],
    options: USER_COMPILER_OPTIONS,
  });

  const tsDiagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];

  if (tsDiagnostics.length > 0) {
    throw new DiagnosticError(tsDiagnostics.map(fromTsDiagnostic));
  }

  const checker = program.getTypeChecker();
  // A `.ts` file under node_modules is a package shipped as TypeScript source and is compiled like
  // user code; only declaration files are excluded (they have no bodies to compile).
  const sourceFiles = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile);
  const entry = program.getSourceFile(entryFile);
  if (!entry) return ice(`entry file ${entryFile} is not in the program`);
  assignModuleIds(sourceFiles, entry);

  return { program, checker, sourceFiles, initOrder: orderModules(entry, checker) };
}

function fromTsDiagnostic(d: ts.Diagnostic): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  let span: Span | null = null;
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    span = { file: d.file.fileName, line: line + 1, col: character + 1 };
  }
  const moduleForm = moduleFormDiagnostic(d, span);
  if (moduleForm) return moduleForm;
  return {
    code: `CS0001`,
    message: `does not typecheck under ChadScript strict mode: ${message} (TS${d.code})`,
    span,
    suggestion: "the program must compile cleanly with tsc --strict before ChadScript accepts it",
  };
}
