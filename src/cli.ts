// CLI entry. Grows one pipeline stage per phase. Phase 0: `check` runs the frontend
// zero-diagnostic gate and (once it exists) the validator, reporting diagnostics.

import { check } from "./pipeline.js";
import { loadProgram } from "./frontend/program.js";
import { validate } from "./validate/validate.js";
import { build } from "./driver/build.js";
import { DiagnosticError, renderDiagnostic, type Diagnostic } from "./diagnostics.js";

function usage(): never {
  process.stderr.write("usage:\n  chad check <entry.ts>\n  chad build <entry.ts> -o <out>\n");
  process.exit(2);
}

function reportAndExit(diagnostics: Diagnostic[]): never {
  for (const d of diagnostics) process.stderr.write(renderDiagnostic(d) + "\n");
  process.stderr.write(`\n${diagnostics.length} error(s)\n`);
  process.exit(1);
}

function main(argv: string[]): void {
  const [cmd, entry, ...rest] = argv;
  if (!entry) usage();

  if (cmd === "check") {
    const result = check(entry);
    if (result.accepted) {
      process.stdout.write("ok: typechecks and is in-subset\n");
      return;
    }
    reportAndExit(result.diagnostics);
  }

  if (cmd === "build") {
    const oIdx = rest.indexOf("-o");
    const outPath = oIdx >= 0 ? rest[oIdx + 1] : undefined;
    if (!outPath) usage();
    try {
      const loaded = loadProgram(entry);
      validate(loaded);
      build(loaded, { outPath });
    } catch (e) {
      if (e instanceof DiagnosticError) reportAndExit(e.diagnostics);
      throw e;
    }
    return;
  }

  usage();
}

main(process.argv.slice(2));
