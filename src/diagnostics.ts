// Diagnostics: the single vocabulary the whole compiler speaks when it refuses a program.
// Every rejection is a coded, spanned Diagnostic — never a bare throw, never a silent skip.

export type Severity = "error";

export interface Span {
  file: string;
  // 1-based line/col, matching editor + tsc conventions.
  line: number;
  col: number;
}

export interface Diagnostic {
  code: string; // e.g. "CS1001"
  message: string;
  span: Span | null; // null only for whole-program diagnostics with no single location
  suggestion?: string; // one-line rewrite hint, shown after the message
}

// Thrown to abort compilation with a batch of user-facing diagnostics. Caught only at the
// top level (CLI / test harness), which renders them and sets a non-zero exit code.
export class DiagnosticError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(`compilation rejected: ${diagnostics.length} diagnostic(s)`);
    this.name = "DiagnosticError";
  }
}

// Internal compiler error: a broken invariant, never the user's fault. `never`-typed so a
// call site is provably unreachable past it — this is how "no silent defaults" is enforced
// (switch default branches call ice(), so an unhandled case crashes loud instead of
// emitting garbage). CS9xxx is reserved for ICEs.
export function ice(message: string): never {
  throw new Error(`[CS9000 internal compiler error] ${message}`);
}

export function renderDiagnostic(d: Diagnostic): string {
  const loc = d.span ? `${d.span.file}:${d.span.line}:${d.span.col}` : "<program>";
  const head = `error[${d.code}]: ${d.message}\n  --> ${loc}`;
  return d.suggestion ? `${head}\n  help: ${d.suggestion}` : head;
}
