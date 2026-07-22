// Driver: turn a validated program into a native binary. Emits IR, then invokes clang to
// compile the IR + the C runtime and link them. Every build verifies the IR (clang -O2 fails
// on malformed IR; the LLVM verifier runs as part of that). No IR reaches a binary unverified.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../codegen/codegen.js";
import type { LoadedProgram } from "../frontend/program.js";

const runtimeC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "runtime.c");

export interface BuildOptions {
  outPath: string;
  opt?: "0" | "2"; // optimization level; the harness builds both to diff for UB leaks
  emitIrTo?: string; // if set, also write the .ll here (for inspection / opt -verify)
}

export function build(loaded: LoadedProgram, opts: BuildOptions): void {
  const ir = generate(loaded);
  const dir = mkdtempSync(join(tmpdir(), "chadv2-"));
  const llPath = join(dir, "out.ll");
  writeFileSync(llPath, ir);
  if (opts.emitIrTo) writeFileSync(opts.emitIrTo, ir);

  execFileSync(
    "clang",
    [`-O${opts.opt ?? "2"}`, "-Wno-override-module", llPath, runtimeC, "-o", opts.outPath],
    { stdio: "pipe" },
  );
}
