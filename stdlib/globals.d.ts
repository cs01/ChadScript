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
  /**
   * The command line. Only `process.argv.slice(2)` — the arguments after the program itself —
   * is supported, and anything else is rejected (CS1229): Node's `argv[0]` is the node binary
   * and `argv[1]` is the script path, neither of which a compiled binary has, so those two
   * entries could never agree with the oracle. The slice itself is exact.
   */
  argv: string[];
  /**
   * This process's id. The VALUE necessarily differs between the oracle and the binary, so a
   * program that prints it cannot be differentially tested — its use is building paths that no
   * concurrently running copy of the same program will collide on.
   */
  pid: number;
};

/**
 * `setTimeout` schedules a callback for a later turn of the event loop. Callbacks fire in
 * (deadline, registration) order and a delay below 1ms is clamped to 1ms, exactly as Node does;
 * the microtask queue drains fully between two callbacks.
 *
 * The callback must be SYNCHRONOUS. TypeScript's void-return bivariance would otherwise let an
 * `async` arrow through here (`() => Promise<void>` is assignable to `() => void`), and its
 * rejection would have no owner — so an async callback is rejected as CS1231 instead.
 *
 * Returns void, not a handle: Node returns a `Timeout` OBJECT, so a printable stand-in would
 * diverge the moment a program logged it. `clearTimeout` therefore does not exist yet — it needs
 * an opaque handle type the value domain does not have. Calling it fails at typecheck (CS0001).
 */
declare function setTimeout(callback: () => void, ms: number): void;

/**
 * `node:path`, POSIX semantics only (the supported targets are macOS and Linux). `join` and
 * `resolve` are variadic here exactly as they are in Node — a `.d.ts` is not walked by the
 * validator, and each call site has a fixed argument list that lowers to an array literal.
 *
 * Deliberately absent: `sep`/`delimiter` (constants, not calls — a later slice), `relative`,
 * `parse`/`format`, and the `win32`/`posix` sub-objects. Importing any of them fails at
 * typecheck (CS0001) rather than reaching lowering.
 */
declare module "node:path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function normalize(path: string): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
}

/**
 * Synchronous filesystem access, imported exactly as Node resolves it: `import { readFileSync }
 * from "node:fs"`. It is a module, not a global, because the oracle runs this same source under
 * Node — where `fs` is not a global. Only the `utf8` encoding is supported: the runtime
 * represents strings as UTF-8 bytes, and a Buffer would need a value representation the subset
 * does not have. A missing path THROWS (as in Node), so `try`/`catch` handles it; `existsSync`
 * answers instead. Only these five names exist here, so anything else fails at typecheck.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function appendFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function unlinkSync(path: string): void;
}

/**
 * Only `Date.now()` is supported — milliseconds since the epoch, truncated exactly as Node
 * truncates it. Date INSTANCES need a value representation (and a calendar) the subset does not
 * have yet, so `new Date()` is rejected (CS1215).
 */
declare const Date: {
  now(): number;
};
