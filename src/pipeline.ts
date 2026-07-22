// The front half of the compiler as one call: frontend gate → validator. Returns the
// diagnostics it would reject with (empty = accepted so far). Shared by the CLI and the
// test harness so both exercise the exact same path. Codegen stages append here later.

import { loadProgram } from "./frontend/program.js";
import { validate } from "./validate/validate.js";
import { type Diagnostic, DiagnosticError } from "./diagnostics.js";

export interface CheckResult {
  accepted: boolean;
  diagnostics: Diagnostic[];
}

export function check(entryFile: string): CheckResult {
  try {
    validate(loadProgram(entryFile));
    return { accepted: true, diagnostics: [] };
  } catch (e) {
    if (e instanceof DiagnosticError) return { accepted: false, diagnostics: e.diagnostics };
    throw e;
  }
}
