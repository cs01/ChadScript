// CLI entry.
//   chad check <entry.ts>                          frontend gate + subset validation, no binary
//   chad build <entry.ts> -o <out>                 compile to a native binary
//   chad run [--fallback=node] <entry.ts> [args]   compile to a temp binary and execute it
//   chad doctor                                    check the toolchain, compile a hello world
//   chad --version

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./pipeline.js";
import { loadProgram } from "./frontend/program.js";
import { validate } from "./validate/validate.js";
import { build } from "./driver/build.js";
import { miloPin } from "./driver/toolchain.js";
import { DiagnosticError, renderDiagnostic, type Diagnostic } from "./diagnostics.js";
import { runUnderNode } from "./fallback.js";
import { doctor } from "./doctor.js";

function usage(): never {
  process.stderr.write(
    "usage:\n" +
      "  chad check <entry.ts>\n" +
      "  chad build <entry.ts> -o <out>\n" +
      "  chad run [--fallback=node] <entry.ts> [args...]\n" +
      "  chad doctor\n" +
      "  chad --version\n",
  );
  process.exit(2);
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const d of diagnostics) process.stderr.write(renderDiagnostic(d) + "\n");
  process.stderr.write(`\n${diagnostics.length} error(s)\n`);
}

function reportAndExit(diagnostics: Diagnostic[]): never {
  printDiagnostics(diagnostics);
  process.exit(1);
}

const ICE_PREFIX = "[CS9000 internal compiler error] ";

// Compile `entry` to `outPath`. Returns the diagnostics when the program is rejected, or when the
// compiler hit an internal error (reported as CS9000: a compiler bug, not the program's fault).
function compile(entry: string, outPath: string): Diagnostic[] | null {
  try {
    const loaded = loadProgram(entry);
    validate(loaded);
    build(loaded, { outPath });
    return null;
  } catch (e) {
    if (e instanceof DiagnosticError) return e.diagnostics;
    if (e instanceof Error && e.message.startsWith(ICE_PREFIX)) {
      return [
        {
          code: "CS9000",
          message: `internal compiler error: ${e.message.slice(ICE_PREFIX.length)}`,
          span: null,
          suggestion:
            "this is a bug in ChadScript, not in your program; please report it with the program " +
            "at https://github.com/cs01/ChadScript/issues (`chad run --fallback=node` runs it " +
            "under Node meanwhile)",
        },
      ];
    }
    throw e;
  }
}

function requireFile(entry: string): void {
  if (existsSync(entry)) return;
  process.stderr.write(`chad: no such file: ${entry}\n`);
  process.exit(2);
}

function version(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return `chad ${pkg.version} (milo ${miloPin()})`;
}

function runCommand(rest: string[]): void {
  let fallback: "node" | null = null;
  let i = 0;
  // Flags come before the entry file; everything after it belongs to the program.
  for (; i < rest.length && rest[i]!.startsWith("--"); i++) {
    const flag = rest[i]!;
    if (flag === "--fallback=node") fallback = "node";
    else {
      process.stderr.write(`chad: unknown option ${flag} (supported: --fallback=node)\n`);
      process.exit(2);
    }
  }
  const entry = rest[i];
  if (!entry) usage();
  requireFile(entry);
  const args = rest.slice(i + 1);
  const outPath = join(mkdtempSync(join(tmpdir(), "chad-run-")), "a.out");
  const rejected = compile(entry, outPath);
  if (rejected) {
    printDiagnostics(rejected);
    if (fallback === null) process.exit(1);
    process.stderr.write("chad: running the program under node instead (--fallback=node)\n");
    process.exit(runUnderNode(entry, args));
  }
  // Forward the child's stdio and exit code.
  try {
    execFileSync(outPath, args, { stdio: "inherit" });
  } catch (e) {
    const status = (e as { status?: number }).status;
    process.exit(typeof status === "number" ? status : 1);
  }
}

function main(argv: string[]): void {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(version() + "\n");
      return;

    case "doctor":
      process.exit(doctor());
      return;

    case "check": {
      const entry = rest[0];
      if (!entry) usage();
      requireFile(entry);
      const result = check(entry);
      if (result.accepted) {
        process.stdout.write("ok: typechecks and is in-subset\n");
        return;
      }
      reportAndExit(result.diagnostics);
      return;
    }

    case "build": {
      const entry = rest[0];
      if (!entry) usage();
      requireFile(entry);
      const oIdx = rest.indexOf("-o");
      const outPath = oIdx >= 0 ? rest[oIdx + 1] : undefined;
      if (!outPath) usage();
      const rejected = compile(entry, outPath);
      if (rejected) reportAndExit(rejected);
      return;
    }

    case "run":
      runCommand(rest);
      return;

    default:
      usage();
  }
}

main(process.argv.slice(2));
