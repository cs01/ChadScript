// Frontend step 1: load a user program through the real TypeScript compiler and enforce the
// zero-diagnostic gate. If tsc reports ANY error under our locked strict options, the
// program is rejected before the validator ever runs — tsc is the type oracle, and an
// un-typecheckable program has no trustworthy types for us to lower.

import ts from "typescript";
import { type Diagnostic, type Span, DiagnosticError } from "../diagnostics.js";
import { USER_COMPILER_OPTIONS } from "./user-options.js";

export interface LoadedProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  // The entry source file and its transitive local sources (excludes lib.d.ts).
  sourceFiles: ts.SourceFile[];
}

// Load + typecheck `entryFile`. Throws DiagnosticError with CS0001 for each tsc diagnostic.
export function loadProgram(entryFile: string): LoadedProgram {
  const program = ts.createProgram({
    rootNames: [entryFile],
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
  const sourceFiles = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sf));

  return { program, checker, sourceFiles };
}

function fromTsDiagnostic(d: ts.Diagnostic): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  let span: Span | null = null;
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    span = { file: d.file.fileName, line: line + 1, col: character + 1 };
  }
  return {
    code: `CS0001`,
    message: `does not typecheck under ChadScript strict mode: ${message} (TS${d.code})`,
    span,
    suggestion: "the program must compile cleanly with tsc --strict before ChadScript accepts it",
  };
}
