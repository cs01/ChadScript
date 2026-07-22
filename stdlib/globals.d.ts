// The ChadScript global environment. Injected into EVERY user compilation (see
// frontend/program.ts); user programs are compiled with `types: []` so @types/node and the
// DOM lib never leak in. This file is therefore the precise, honest surface of supported
// globals — it tracks codegen exactly. A signature here must be backed by real lowering;
// widen it only when the corresponding codegen lands. Phase 0: console.log(string) and
// process.exit(number).

declare const console: {
  /**
   * Prints its arguments space-separated, followed by a newline (Node semantics). Each value
   * is formatted per its type: numbers JS-exactly, booleans as "true"/"false", strings as-is.
   */
  log(...values: unknown[]): void;
};

declare const process: {
  /** Terminates with the given exit code. */
  exit(code: number): never;
};
