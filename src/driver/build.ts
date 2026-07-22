// Driver: turn a validated program into a native binary. Emits IR, then invokes clang to
// compile the IR and link it with the C runtime. Every build verifies the IR (clang fails on
// malformed IR; the LLVM verifier runs as part of that). No IR reaches a binary unverified.
//
// The runtime .c files are compiled ONCE to cached .o files (CONTENT-ADDRESSED — keyed by a hash
// of the source + runtime headers + compiler flags) and reused across every build; recompiling
// them per program was the dominant cost of the test suite. Content addressing (vs the old mtime
// key) survives `git checkout`/`touch`, never serves a stale object, and rebuilds when any runtime
// header changes.

import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { lower } from "../lower/lower.js";
import { verifyHir } from "../hir/verify.js";
import { generate } from "../codegen/codegen.js";
import { CLANG, GC_CFLAGS, GC_LFLAGS } from "./toolchain.js";
import type { LoadedProgram } from "../frontend/program.js";

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runtimeDir = join(repoRoot, "runtime");
const cacheDir = join(repoRoot, ".build", "runtime");

// Every .c under runtime/ is part of the runtime; compile them all so new bridges/helpers are
// picked up without editing the driver.
const runtimeSources = readdirSync(runtimeDir)
  .filter((f) => f.endsWith(".c"))
  .map((f) => join(runtimeDir, f));

// The compile flags a runtime object depends on (a flag change must invalidate the cache).
const RUNTIME_COMPILE_FLAGS = ["-O2", "-c", ...GC_CFLAGS];

// A content-addressed cache key for one runtime object: hashes the .c bytes, EVERY runtime header
// (a header edit must rebuild the .c's that include it — the mtime scheme missed this), and the
// compile flags. Pure + deterministic, so it is unit-tested directly.
export function runtimeObjectKey(
  cSource: Buffer,
  headerContents: readonly Buffer[],
  flags: readonly string[],
): string {
  const h = createHash("sha256");
  h.update(cSource);
  for (const hdr of headerContents) h.update(hdr);
  h.update(flags.join("\0"));
  return h.digest("hex").slice(0, 16);
}

function headerContents(): Buffer[] {
  return readdirSync(runtimeDir)
    .filter((f) => f.endsWith(".h"))
    .sort() // stable order → stable key regardless of readdir ordering
    .map((f) => readFileSync(join(runtimeDir, f)));
}

// Compile each runtime .c to a content-addressed cached .o (`.build/runtime/<name>.<key>.o`);
// reuse it whenever that exact file already exists (a cache hit needs no recompile). Runtime code
// is independent of the program's opt level, so a single -O2 build is reused for both -O0 and -O2
// program links. Call once before launching concurrent links so the (racy) cache-fill happens once.
export function runtimeObjects(): string[] {
  mkdirSync(cacheDir, { recursive: true });
  const headers = headerContents();
  return runtimeSources.map((src) => {
    const key = runtimeObjectKey(readFileSync(src), headers, RUNTIME_COMPILE_FLAGS);
    const obj = join(cacheDir, `${basename(src, ".c")}.${key}.o`);
    if (!existsSync(obj)) {
      execFileSync(CLANG, [...RUNTIME_COMPILE_FLAGS, src, "-o", obj], { stdio: "pipe" });
    }
    return obj;
  });
}

// frontend (loaded) → lower (HIR) → verify → codegen (IR). The checker stops at lower; verifyHir
// then proves every HIR node is typed before the backend (which has zero inference) runs.
export function emitIr(loaded: LoadedProgram): string {
  return generate(verifyHir(lower(loaded)));
}

function linkArgs(llPath: string, outPath: string, opt: "0" | "2", objs: string[]): string[] {
  return [
    `-O${opt}`,
    "-Wno-override-module",
    llPath,
    ...objs,
    "-lm", // `%` lowers to an fmod libcall in libm; macOS auto-links it, Linux doesn't
    ...GC_LFLAGS, // Boehm GC
    "-o",
    outPath,
  ];
}

export interface BuildOptions {
  outPath: string;
  opt?: "0" | "2"; // optimization level; the harness builds both to diff for UB leaks
  emitIrTo?: string; // if set, also write the .ll here (for inspection / opt -verify)
}

export function build(loaded: LoadedProgram, opts: BuildOptions): void {
  const ir = emitIr(loaded);
  const dir = mkdtempSync(join(tmpdir(), "chadv2-"));
  const llPath = join(dir, "out.ll");
  writeFileSync(llPath, ir);
  if (opts.emitIrTo) writeFileSync(opts.emitIrTo, ir);
  execFileSync(CLANG, linkArgs(llPath, opts.outPath, opts.opt ?? "2", runtimeObjects()), {
    stdio: "pipe",
  });
}

// Compile already-emitted IR (written to `llPath`) to a binary, asynchronously — lets a caller
// link -O0 and -O2 concurrently. Runtime objects must be pre-built (call runtimeObjects first).
export async function linkIr(
  llPath: string,
  outPath: string,
  opt: "0" | "2",
  objs: string[],
): Promise<void> {
  await execFileAsync(CLANG, linkArgs(llPath, outPath, opt, objs));
}
