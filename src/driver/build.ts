// Driver: turn a validated program into a native binary. Emits IR, then invokes clang to
// compile the IR + the C runtime and link them. Every build verifies the IR (clang -O2 fails
// on malformed IR; the LLVM verifier runs as part of that). No IR reaches a binary unverified.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lower } from "../lower/lower.js";
import { generate } from "../codegen/codegen.js";
import { CLANG, GC_FLAGS } from "./toolchain.js";
import type { LoadedProgram } from "../frontend/program.js";

const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime");
// Every .c under runtime/ is part of the runtime; compile them all so new bridges/helpers
// are picked up without editing the driver.
const runtimeSources = readdirSync(runtimeDir)
  .filter((f) => f.endsWith(".c"))
  .map((f) => join(runtimeDir, f));

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
      ...runtimeSources,
      "-lm", // `%` on doubles lowers to an fmod libcall in libm; macOS auto-links it, Linux doesn't
      ...GC_FLAGS, // Boehm GC (libgc)
      "-o",
      opts.outPath,
    ],
    { stdio: "pipe" },
  );
}
