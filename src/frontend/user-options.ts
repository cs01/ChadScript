// The tsconfig we impose on EVERY user program. Non-negotiable: max strictness is what lets
// tsc be our type oracle. A program that does not typecheck cleanly under these options is
// not a program we compile (see frontend/program.ts zero-diagnostic gate).
//
// These are constructed in code, not read from the user's tsconfig — the user does not get
// to loosen them.

import ts from "typescript";

export const USER_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2023.d.ts"],

  // User programs get ONLY the ChadScript global environment (stdlib/globals.d.ts, injected
  // in program.ts) — never @types/node or the DOM lib. `types: []` disables automatic @types
  // inclusion so a program cannot typecheck against globals we don't actually compile.
  types: [],

  // The strictness that makes the checker's answers trustworthy.
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noPropertyAccessFromIndexSignature: true,
  noFallthroughCasesInSwitch: true,
  noImplicitReturns: true,
  useUnknownInCatchVariables: true,

  // We only ever read types; never emit JS from tsc.
  noEmit: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
};
