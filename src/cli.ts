// CLI entry. Grows one pipeline stage per phase.
//   chad check <entry.ts>            frontend gate + subset validation, no output binary
//   chad build <entry.ts> -o <out>   compile to a native binary
//   chad run   <entry.ts> [args...]  compile to a temp binary and execute it

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "./pipeline.js";
import { loadProgram } from "./frontend/program.js";
import { validate } from "./validate/validate.js";
import { build } from "./driver/build.js";
import { DiagnosticError, renderDiagnostic, type Diagnostic } from "./diagnostics.js";

function usage(): never {
  process.stderr.write(
    "usage:\n" +
      "  chad check <entry.ts>\n" +
      "  chad build <entry.ts> -o <out>\n" +
      "  chad run   <entry.ts> [args...]\n",
  );
  process.exit(2);
}

function reportAndExit(diagnostics: Diagnostic[]): never {
  for (const d of diagnostics) process.stderr.write(renderDiagnostic(d) + "\n");
  process.stderr.write(`\n${diagnostics.length} error(s)\n`);
  process.exit(1);
}

// Compile `entry` to `outPath`, converting rejection into a clean diagnostic exit.
function compile(entry: string, outPath: string): void {
  try {
    const loaded = loadProgram(entry);
    validate(loaded);
    build(loaded, { outPath });
  } catch (e) {
    if (e instanceof DiagnosticError) reportAndExit(e.diagnostics);
    throw e;
  }
}

function main(argv: string[]): void {
  const [cmd, entry, ...rest] = argv;
  if (!entry) usage();

  switch (cmd) {
    case "check": {
      const result = check(entry);
      if (result.accepted) {
        process.stdout.write("ok: typechecks and is in-subset\n");
        return;
      }
      reportAndExit(result.diagnostics);
      return;
    }

    case "build": {
      const oIdx = rest.indexOf("-o");
      const outPath = oIdx >= 0 ? rest[oIdx + 1] : undefined;
      if (!outPath) usage();
      compile(entry, outPath);
      return;
    }

    case "run": {
      const outPath = join(mkdtempSync(join(tmpdir(), "chad-run-")), "a.out");
      compile(entry, outPath);
      // Forward the child's stdio and exit code; the program's args follow the entry file.
      try {
        execFileSync(outPath, rest, { stdio: "inherit" });
      } catch (e) {
        const status = (e as { status?: number }).status;
        process.exit(typeof status === "number" ? status : 1);
      }
      return;
    }

    default:
      usage();
  }
}

main(process.argv.slice(2));
