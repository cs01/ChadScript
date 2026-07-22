// CLI entry. Grows one pipeline stage per phase. Phase 0: `check` runs the frontend
// zero-diagnostic gate and (once it exists) the validator, reporting diagnostics.

import { loadProgram } from "./frontend/program.js";
import { DiagnosticError, renderDiagnostic } from "./diagnostics.js";

function usage(): never {
  process.stderr.write("usage: chad check <entry.ts>\n");
  process.exit(2);
}

function main(argv: string[]): void {
  const [cmd, entry] = argv;
  if (cmd !== "check" || !entry) usage();

  try {
    const { sourceFiles } = loadProgram(entry);
    process.stdout.write(`ok: ${sourceFiles.length} source file(s) typecheck under strict mode\n`);
  } catch (e) {
    if (e instanceof DiagnosticError) {
      for (const d of e.diagnostics) process.stderr.write(renderDiagnostic(d) + "\n");
      process.stderr.write(`\n${e.diagnostics.length} error(s)\n`);
      process.exit(1);
    }
    throw e;
  }
}

main(process.argv.slice(2));
