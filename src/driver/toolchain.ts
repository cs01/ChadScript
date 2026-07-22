// Resolved names of the LLVM tools we shell out to. Overridable via env so CI (where LLVM is
// often installed as versioned binaries like `opt-18`) can point us at the right ones without
// touching code. Defaults assume `clang`/`opt` are on PATH (true for a Homebrew LLVM install).

export const CLANG = process.env["CHAD_CLANG"] ?? "clang";
export const OPT = process.env["CHAD_OPT"] ?? "opt";
