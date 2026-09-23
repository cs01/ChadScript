// Resolved names of the LLVM tools we shell out to. Overridable via env so CI (where LLVM is
// often installed as versioned binaries like `opt-18`) can point us at the right ones without
// touching code. Defaults assume `clang`/`opt` are on PATH (true for a Homebrew LLVM install).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLANG = process.env["CHAD_CLANG"] ?? "clang";
export const OPT = process.env["CHAD_OPT"] ?? "opt";

// The Milo compiler the runtime is built with (runtime/*.milo). `scripts/setup-milo.sh` fetches
// the commit pinned in `scripts/milo-pin.sh` into `.milo/`; `CHAD_MILO` points at another `milo`
// wrapper instead (a local checkout, when working on Milo itself; its edits are not in the
// runtime cache key, so clear `.build/runtime` after changing it).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MILO = process.env["CHAD_MILO"] ?? join(repoRoot, ".milo", "milo");

// The pinned Milo commit, read from the pin file so the setup script, CI and the runtime cache
// key share one source of truth.
export function miloPin(): string {
  const text = readFileSync(join(repoRoot, "scripts", "milo-pin.sh"), "utf8");
  const m = /^MILO_COMMIT="([0-9a-f]{40})"$/m.exec(text);
  if (!m) throw new Error('scripts/milo-pin.sh: no MILO_COMMIT="<40-hex sha>" line');
  return m[1]!;
}

// Sanitizer lane. `CHAD_SAN=1` builds the runtime AND the program with AddressSanitizer +
// UndefinedBehaviorSanitizer. Run the ordinary suite with it set (`bun run test:san`): with
// -fno-sanitize-recover any report aborts the binary, which the differential harness already sees
// as a crash/exit divergence, so no separate assertions are needed.
//
// The runtime is Milo: its IR is emitted with `milo emit-ir --sanitize` (every function marked
// sanitize_address) and compiled with these flags, so ASan instruments it like C. UBSan does NOT
// reach it: UBSan checks are inserted by clang's C frontend, which Milo IR never passes through.
// Milo covers most of that class itself (integer overflow and array-bounds traps in every build);
// raw-pointer arithmetic inside `unsafe` is checked by ASan only. Only runtime/residue.c gets
// both.
//
// WHAT THIS LANE COVERS, measured by injecting each bug and checking it is reported:
//   - stack and global buffer overflows, out-of-bounds array indexing, integer/alignment UB — YES
//   - a runtime read of a collected GC object — YES while its line is free: the collector
//     (runtime/gc.milo) ASan-poisons free lines and unpoisons a hole when it hands it out
//     (tests/runtime/gc_poison_test.c pins it). Generated code is not instrumented (its IR has no
//     sanitize_address attribute), so only runtime reads are checked.
//   - overflows between GC objects — NO. Objects are bump-allocated back to back inside a hole,
//     with no redzones between them. The collector's own bugs have their own gates:
//     CHAD_GC_STRESS (collect before every Nth allocation) and CHAD_GC_VERIFY (fill freed lines
//     with a pattern, abort on a traced slot that points at freed memory).
//   - a stack pointer escaping through cs_throw — NO, and no sanitizer can. longjmp triggers
//     __asan_handle_no_return, which unpoisons the abandoned frame to avoid false positives.
//     That class is closed structurally instead: cs_new_error copies its message
//     (tests/runtime/throw_msg_copy_test.c pins it).
//
// The collector needs two ASan behaviors disabled to coexist, set in the lane's ASAN_OPTIONS:
// detect_leaks (heap chunks and fiber stacks are process-lifetime memory, which reads as a leak)
// and detect_stack_use_after_return (ASan's fake stack moves locals off the machine stack, where
// the conservative root scan would not see them, so reachable objects would be collected). The
// scan itself (residue.c cs_gc_scan) is not instrumented, since it reads stack and global redzones
// on purpose.
export const SANITIZE = process.env["CHAD_SAN"] === "1";

export const SAN_FLAGS = SANITIZE
  ? ["-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-fno-sanitize-recover=all"]
  : [];
