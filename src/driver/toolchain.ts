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
