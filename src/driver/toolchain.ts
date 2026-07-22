// Resolved names of the LLVM tools we shell out to. Overridable via env so CI (where LLVM is
// often installed as versioned binaries like `opt-18`) can point us at the right ones without
// touching code. Defaults assume `clang`/`opt` are on PATH (true for a Homebrew LLVM install).

import { existsSync } from "node:fs";

export const CLANG = process.env["CHAD_CLANG"] ?? "clang";
export const OPT = process.env["CHAD_OPT"] ?? "opt";

// Boehm GC (libgc) link flags. Linux (apt libgc-dev) installs into system paths, so `-lgc`
// alone suffices; a Homebrew install needs explicit -I/-L. `CHAD_GC_PREFIX` overrides both.
function gcFlags(): string[] {
  const flags = ["-lgc"];
  const prefix =
    process.env["CHAD_GC_PREFIX"] ??
    (existsSync("/opt/homebrew/opt/bdw-gc") ? "/opt/homebrew/opt/bdw-gc" : "");
  if (prefix) flags.unshift(`-I${prefix}/include`, `-L${prefix}/lib`);
  return flags;
}

export const GC_FLAGS = gcFlags();
