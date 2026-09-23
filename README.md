# ChadScript

**An ahead-of-time compiler for a statically analyzable subset of TypeScript.** Ordinary `.ts`
in, a small native binary out. Every program it accepts behaves exactly as it does under Node;
everything else is rejected at compile time with a diagnostic that says why.

> Status: pre-alpha, on the `v2` branch. The pipeline works end to end, but the object model is
> being replaced (see [`PLAN.md`](PLAN.md)); until then, some structurally typed programs
> miscompile. Don't use it for anything real yet.

```ts
// examples/shapes.ts (excerpt)
class Circle extends Shape {
  radius: number;
  constructor(radius: number) {
    super("circle");
    this.radius = radius;
  }
  override area(): number {
    return Math.PI * this.radius * this.radius;
  }
}
```

```sh
bin/chad build examples/shapes.ts -o shapes   # 94 KB binary (+ libgc)
./shapes                                      # ~2 ms; the same file under Node: ~48 ms
```

## Quick start

Needs [bun](https://bun.sh), clang/LLVM, and Boehm GC (`brew install bdw-gc` or
`apt install libgc-dev`).

```sh
bun install
bin/chad check file.ts            # typecheck + subset validation only
bin/chad build file.ts -o out     # native binary
bin/chad run   file.ts [args...]  # build to a temp dir and run
bun test tests/                   # differential + rejection suites
```

## What "subset" means

The compiler runs tsc at maximum strictness first; a program with any type error is not
compiled. Then a **default-deny validator** admits only constructs on an explicit allowlist,
each backed by a test that runs the program under Node and natively and diffs the output.
Anything else fails with a code, a source span and a suggested rewrite:

```text
error[CS1219]: a closure cannot capture the mutable variable `count` yet
  --> f.ts:2:13
  help: declare it `const`, or restructure so the closure does not close over an outer `let`
```

Supported today: numbers, strings, booleans, control flow, functions and closures, arrays,
object literals, classes with inheritance and virtual dispatch, `Map`/`Set`, optional values,
spread, try/catch/finally, async/await, timers, `node:fs` (sync and promises), `node:path`,
and multi-file ES modules (named, default and namespace imports, re-exports, specifiers as
TypeScript writes them, npm packages that ship TypeScript source).
The generated [`docs/SUBSET.md`](docs/SUBSET.md) is the exact list.

Not supported, by design: `any`, `eval`, prototype mutation, adding or deleting properties at
runtime, CommonJS, packages that ship only JavaScript. Programs that need those should run on Node (or
[milojs](https://github.com/milo-language/milojs)); since every accepted program is valid
TypeScript, the same file runs there unchanged.

Not supported yet, planned: unions with mixed representations (`number | string`); generics;
closures that mutate captured variables; optional chains longer than one `?.`. See the phases in [`PLAN.md`](PLAN.md).

## How it works

```text
.ts ──tsc (types, strict)──▶ validator (default-deny) ──▶ lower ──▶ HIR (every node typed)
     ──▶ verifyHir ──▶ codegen ──▶ typed LLVM IR builder ──▶ clang -O2 ──▶ binary + runtime
```

- **tsc is the only type oracle.** The compiler never infers a type itself.
- **Only `src/lower/` talks to tsc.** HIR and codegen cannot import TypeScript; a test enforces it.
- **Node is the semantics oracle.** Every fixture is diffed against Node at `-O0` and `-O2`, and
  the IR is checked with `opt -passes=verify`. A seeded fuzzer generates programs in the subset.
- **Runtime** (`runtime/`, written in [Milo](https://github.com/milo-language/milo) with a
  ~20-line C residue; `sh scripts/setup-milo.sh` fetches the pinned compiler): UTF-8 `{ptr, len}` strings, JS-exact number formatting, Boehm GC, ucontext fibers for async,
  a microtask/timer/I/O event loop.

## Docs

- [`PLAN.md`](PLAN.md): the charter. Mission, value model, modules, GC and runtime plan, phases.
- [`docs/SUBSET.md`](docs/SUBSET.md): the accepted subset, generated from the validator.
- [`docs/async-design.md`](docs/async-design.md): the async runtime model.
- [`CLAUDE.md`](CLAUDE.md): dev loop and working rules.

## History

`main` holds v1, a self-hosting compiler that inferred types during codegen and could not be
stabilized. A second attempt (`hir`) went fully dynamic and lost scope. This branch is the third,
built around tsc as the type oracle and Node as the test oracle. [`PLAN.md`](PLAN.md) has the
post-mortems.

## License

MIT
