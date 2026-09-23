# ChadScript

**An ahead-of-time compiler for a statically analyzable subset of TypeScript.** Ordinary `.ts`
in, a small native binary out. Every program it accepts behaves exactly as it does under Node;
everything else is rejected at compile time with a diagnostic that says why.

> Status: pre-alpha. Phases 0-6 of [`PLAN.md`](PLAN.md) are done (modules, Milo runtime, shaped
> objects, unions, closures, generics, own GC); the 0.1 release is in progress.

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
bin/chad build examples/shapes.ts -o shapes   # ~130 KB self-contained binary
./shapes                                      # ~2 ms; the same file under Node: ~48 ms
```

## Quick start

Needs [bun](https://bun.sh) and clang/LLVM. No GC library: the runtime brings its own collector.

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
error[CS1242]: a generic type parameter instantiated with number[]: an erased T holds one self-describing value (a number, string, boolean, null, undefined or object)
  --> f.ts:6:13
  help: wrap it in an object (`{ items: xs }`), or write a non-generic function for this type
```

Supported today: numbers, strings, booleans, control flow, functions and closures (including
closures that reassign captured variables, with JS per-iteration loop bindings), erased generic
functions and classes, arrays,
object literals, classes with inheritance and virtual dispatch, `Map`/`Set`, optional values,
unions of different kinds (`number | string`, `string[] | boolean | null`) narrowed by `typeof`,
`===`, `instanceof`, `Array.isArray` and truthiness, spread, try/catch/finally, async/await, timers, `node:fs` (sync and promises), `node:path`,
and multi-file ES modules (named, default and namespace imports, re-exports, specifiers as
TypeScript writes them, npm packages that ship TypeScript source).
The generated [`docs/SUBSET.md`](docs/SUBSET.md) is the exact list.

Not supported, by design: `any`, `eval`, prototype mutation, adding or deleting properties at
runtime, CommonJS, packages that ship only JavaScript. Programs that need those should run on Node (or
[milojs](https://github.com/milo-language/milojs)); since every accepted program is valid
TypeScript, the same file runs there unchanged.

Not supported yet, planned: generics instantiated with arrays, maps or functions (wrap them in an
object), and generic containers shared with non-generic code; optional chains longer than one `?.`; operations on an un-narrowed union beyond printing, `===`, `typeof`, `??`
and truthiness (narrow it first); `Map`/`Set` keyed by a union. See the phases in [`PLAN.md`](PLAN.md).

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
  ~20-line C residue; `sh scripts/setup-milo.sh` fetches the pinned compiler): UTF-8 `{ptr, len}` strings, JS-exact number formatting, its own garbage collector (conservative roots, precise
  heap, inline bump allocation, no libgc dependency), ucontext fibers for async,
  a microtask/timer/I/O event loop.

## Docs

- [`PLAN.md`](PLAN.md): the charter. Mission, value model, modules, GC and runtime plan, phases.
- [`docs/SUBSET.md`](docs/SUBSET.md): the accepted subset, generated from the validator.
- [`docs/async-design.md`](docs/async-design.md): the async runtime model.
- [`CLAUDE.md`](CLAUDE.md): dev loop and working rules.

## History

Branch `v1` (tag `v1-final`) holds v1, a self-hosting compiler that inferred types during codegen
and could not be stabilized. A second attempt (`hir`) went fully dynamic and lost scope. This is the third,
built around tsc as the type oracle and Node as the test oracle. [`PLAN.md`](PLAN.md) has the
post-mortems.

## License

MIT
