// Driver: turn a validated program into a native binary. Emits IR, then invokes clang to
// compile the IR and link it with the runtime (Milo, plus a small C residue). Every build verifies
// the IR (clang fails on malformed IR; the LLVM verifier runs as part of that). No IR reaches a
// binary unverified.
//
// The runtime is compiled ONCE to cached .o files (CONTENT-ADDRESSED: keyed by a hash of the
// sources + headers + compiler identity + flags) and reused across every build; recompiling it per
// program was the dominant cost of the test suite. Content addressing (vs the old mtime key)
// survives `git checkout`/`touch`, never serves a stale object, and rebuilds when any input
// changes. Each C file compiles to its own object; all Milo files compile as ONE unit rooted at
// runtime/lib.milo, so Milo-internal helpers are defined once rather than once per module.

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
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { lower } from "../lower/lower.js";
import { verifyHir } from "../hir/verify.js";
import { generate } from "../codegen/codegen.js";
import { CLANG, MILO, SAN_FLAGS, SANITIZE, miloPin } from "./toolchain.js";
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
const RUNTIME_COMPILE_FLAGS = ["-O2", "-c", ...SAN_FLAGS];

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

// Milo emits IR and we compile it with the same clang and flags as the C files, rather than via
// `milo emit-obj`: that keeps one toolchain (CHAD_CLANG) and lets the sanitized lane instrument
// the Milo runtime too (`--sanitize` marks every function sanitize_address, which is what makes
// clang's ASan pass touch IR input; UBSan checks are inserted by clang's C frontend, so the Milo
// code gets ASan but not UBSan).
const MILO_EMIT_FLAGS = ["emit-ir", ...(SANITIZE ? ["--sanitize"] : [])];

// Every .milo under runtime/ is hashed into the key, not just the root: an edit to any imported
// module must rebuild the unit. Sorted so the key is independent of readdir order.
function miloSources(): Buffer {
  const files = readdirSync(runtimeDir)
    .filter((f) => f.endsWith(".milo"))
    .sort();
  return Buffer.concat(files.flatMap((f) => [Buffer.from(f), readFileSync(join(runtimeDir, f))]));
}

// Write-then-rename, so a concurrent build never links a half-written object.
function compileInto(obj: string, compile: (tmp: string) => void): void {
  const tmp = `${obj}.${process.pid}.tmp`;
  compile(tmp);
  renameSync(tmp, obj);
}

function miloRuntimeObject(): string {
  if (!existsSync(MILO)) {
    throw new Error(
      `Milo compiler not found at ${MILO}: run scripts/setup-milo.sh or set CHAD_MILO`,
    );
  }
  const identity = [miloPin(), MILO, process.platform, process.arch, ...MILO_EMIT_FLAGS];
  const key = runtimeObjectKey(miloSources(), [], [...identity, ...RUNTIME_COMPILE_FLAGS]);
  const obj = join(cacheDir, `milo.${key}.o`);
  if (existsSync(obj)) return obj;
  compileInto(obj, (tmp) => {
    const ll = `${tmp}.ll`;
    execFileSync(MILO, [...MILO_EMIT_FLAGS, join(runtimeDir, "lib.milo"), "-o", ll], {
      stdio: "pipe",
    });
    try {
      // A global whose initializer is not a constant (a `string`, anything allocated) is set by
      // Milo's global_init, which only a Milo `main` calls. The runtime has no Milo main, so such
      // a global would silently stay zeroed; refuse to build instead.
      if (readFileSync(ll, "utf8").includes("@__milo.global_init")) {
        throw new Error(
          "runtime/*.milo: a global needs a runtime initializer (Milo global_init), which never " +
            "runs without a Milo main; use a constant initializer or a function-local value",
        );
      }
      execFileSync(CLANG, [...RUNTIME_COMPILE_FLAGS, "-Wno-override-module", ll, "-o", tmp], {
        stdio: "pipe",
      });
    } finally {
      rmSync(ll, { force: true });
    }
  });
  return obj;
}

// Compile each runtime .c, and the Milo unit, to a content-addressed cached .o
// (`.build/runtime/<name>.<key>.o`); reuse it whenever that exact file already exists (a cache hit
// needs no recompile). Runtime code is independent of the program's opt level, so a single -O2
// build is reused for both -O0 and -O2 program links. Call once before launching concurrent links
// so the cache-fill happens once.
export function runtimeObjects(): string[] {
  mkdirSync(cacheDir, { recursive: true });
  const headers = headerContents();
  const cObjs = runtimeSources.map((src) => {
    const key = runtimeObjectKey(readFileSync(src), headers, RUNTIME_COMPILE_FLAGS);
    const obj = join(cacheDir, `${basename(src, ".c")}.${key}.o`);
    if (!existsSync(obj)) {
      compileInto(obj, (tmp) =>
        execFileSync(CLANG, [...RUNTIME_COMPILE_FLAGS, src, "-o", tmp], { stdio: "pipe" }),
      );
    }
    return obj;
  });
  return [...cObjs, miloRuntimeObject()];
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
    ...SAN_FLAGS,
    llPath,
    ...objs,
    "-lm", // `%` lowers to an fmod libcall in libm; macOS auto-links it, Linux doesn't
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
