// CLI entry. Grows one pipeline stage per phase. Phase 0: `check` runs the frontend
// zero-diagnostic gate and (once it exists) the validator, reporting diagnostics.

import { check } from "./pipeline.js";
import { renderDiagnostic } from "./diagnostics.js";

function usage(): never {
  process.stderr.write("usage: chad check <entry.ts>\n");
  process.exit(2);
}

function main(argv: string[]): void {
  const [cmd, entry] = argv;
  if (cmd !== "check" || !entry) usage();

  const result = check(entry);
  if (result.accepted) {
    process.stdout.write("ok: typechecks and is in-subset\n");
    return;
  }
  for (const d of result.diagnostics) process.stderr.write(renderDiagnostic(d) + "\n");
  process.stderr.write(`\n${result.diagnostics.length} error(s)\n`);
  process.exit(1);
}

main(process.argv.slice(2));
