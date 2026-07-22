// Driver: turn a validated program into a native binary. Emits IR, then invokes clang to
// compile the IR and link it with the C runtime. Every build verifies the IR (clang fails on
// malformed IR; the LLVM verifier runs as part of that). No IR reaches a binary unverified.
//
// The runtime .c files are compiled ONCE to cached .o files (keyed by source mtime) and reused
// across every build — recompiling them per program was the dominant cost of the test suite.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { lower } from "../lower/lower.js";
import { generate } from "../codegen/codegen.js";
import { CLANG, GC_CFLAGS, GC_LFLAGS } from "./toolchain.js";
import type { LoadedProgram } from "../frontend/program.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runtimeDir = join(repoRoot, "runtime");
const cacheDir = join(repoRoot, ".build", "runtime");

// Every .c under runtime/ is part of the runtime; compile them all so new bridges/helpers are
// picked up without editing the driver.
const runtimeSources = readdirSync(runtimeDir)
  .filter((f) => f.endsWith(".c"))
  .map((f) => join(runtimeDir, f));

// Compile each runtime .c to a cached .o if the object is missing or older than its source.
// Runtime code is independent of the program's opt level, so a single -O2 build is reused for
// both -O0 and -O2 program links. Returns the object-file paths.
function runtimeObjects(): string[] {
  mkdirSync(cacheDir, { recursive: true });
  return runtimeSources.map((src) => {
    const obj = join(cacheDir, basename(src).replace(/\.c$/, ".o"));
    const stale = !existsSync(obj) || statSync(obj).mtimeMs < statSync(src).mtimeMs;
    if (stale) {
      execFileSync(CLANG, ["-O2", "-c", ...GC_CFLAGS, src, "-o", obj], { stdio: "pipe" });
    }
    return obj;
  });
}

export interface BuildOptions {
  outPath: string;
  opt?: "0" | "2"; // optimization level; the harness builds both to diff for UB leaks
  emitIrTo?: string; // if set, also write the .ll here (for inspection / opt -verify)
}

export function build(loaded: LoadedProgram, opts: BuildOptions): void {
  // frontend (loaded) → lower (HIR) → codegen (IR). The checker stops at lower.
  const ir = generate(lower(loaded));
  const dir = mkdtempSync(join(tmpdir(), "chadv2-"));
  const llPath = join(dir, "out.ll");
  writeFileSync(llPath, ir);
  if (opts.emitIrTo) writeFileSync(opts.emitIrTo, ir);

  execFileSync(
    CLANG,
    [
      `-O${opts.opt ?? "2"}`,
      "-Wno-override-module",
      llPath,
      ...runtimeObjects(),
      "-lm", // `%` on doubles lowers to an fmod libcall in libm; macOS auto-links it, Linux doesn't
      ...GC_LFLAGS, // Boehm GC (libgc)
      "-o",
      opts.outPath,
    ],
    { stdio: "pipe" },
  );
}
