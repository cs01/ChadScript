// Resolved names of the LLVM tools we shell out to. Overridable via env so CI (where LLVM is
// often installed as versioned binaries like `opt-18`) can point us at the right ones without
// touching code. Defaults assume `clang`/`opt` are on PATH (true for a Homebrew LLVM install).

import { existsSync } from "node:fs";

export const CLANG = process.env["CHAD_CLANG"] ?? "clang";
export const OPT = process.env["CHAD_OPT"] ?? "opt";

// Boehm GC (libgc) locations. Linux (apt libgc-dev) installs into system paths; a Homebrew
// install needs explicit -I/-L. `CHAD_GC_PREFIX` overrides. Compile flags (-I, for the runtime
// .c files that include <gc.h>) are split from link flags (-L, -lgc).
function gcPrefix(): string {
  return (
    process.env["CHAD_GC_PREFIX"] ??
    (existsSync("/opt/homebrew/opt/bdw-gc") ? "/opt/homebrew/opt/bdw-gc" : "")
  );
}

const prefix = gcPrefix();
export const GC_CFLAGS = prefix ? [`-I${prefix}/include`] : [];
export const GC_LFLAGS = prefix ? [`-L${prefix}/lib`, "-lgc"] : ["-lgc"];

// Sanitizer lane. `CHAD_SAN=1` builds the runtime AND the program with AddressSanitizer +
// UndefinedBehaviorSanitizer. Run the ordinary suite with it set (`bun run test:san`): with
// -fno-sanitize-recover any report aborts the binary, which the differential harness already sees
// as a crash/exit divergence, so no separate assertions are needed.
//
// WHAT THIS LANE COVERS, measured by injecting each bug and checking it is reported:
//   - stack and global buffer overflows, out-of-bounds array indexing, integer/alignment UB — YES
//   - overflows of Boehm-managed memory — NO. GC_malloc has its own mmap-based heap, so ASan's
//     redzones never apply to it, and most runtime data lives there. Covering it needs Boehm's
//     own GC_DEBUG redzones, which is a separate lane.
//   - a stack pointer escaping through cs_throw — NO, and no sanitizer can. longjmp triggers
//     __asan_handle_no_return, which unpoisons the abandoned frame to avoid false positives.
//     That class is closed structurally instead: cs_new_error copies its message
//     (tests/runtime/throw_msg_copy_test.c pins it).
//
// Boehm needs two ASan behaviors disabled to coexist, set in the lane's ASAN_OPTIONS:
// detect_leaks (a conservative GC never frees, so every live object reads as a leak) and
// detect_stack_use_after_return (ASan's fake stack hides real frames from the GC's conservative
// scan, which would collect objects that are still reachable).
export const SANITIZE = process.env["CHAD_SAN"] === "1";

export const SAN_FLAGS = SANITIZE
  ? ["-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-fno-sanitize-recover=all"]
  : [];
