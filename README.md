# ChadScript

**An ahead-of-time compiler for a statically analyzable subset of TypeScript.** Ordinary `.ts`
in, a small native binary out. Every program it accepts behaves exactly as it does under Node;
everything else is rejected at compile time with a diagnostic that says why.
Documentation: **[cs01.github.io/ChadScript](https://cs01.github.io/ChadScript/)**.

> Status: alpha, not released yet; 2.0.0-alpha.1 is in preparation ([changelog](CHANGELOG.md)).
> It builds from a source checkout; no prebuilt binaries yet.

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

## Install

Needs [bun](https://bun.sh) 1.3, LLVM (`clang` and `opt`), git, and Node.js 20.6 or newer (for
the test suite). No GC library: the runtime brings its own collector.
Tested on macOS arm64 and Linux x86-64.

```sh
git clone https://github.com/cs01/ChadScript
cd ChadScript
bun install
sh scripts/setup-milo.sh    # fetches the pinned Milo compiler the runtime is written in
bin/chad doctor             # checks the toolchain, then compiles and runs a hello world
```

`bin/chad doctor` prints one line per check, with a fix for anything missing:

```text
  ok    bun          1.3.10
  ok    node         v25.3.0
  ok    clang        22.1.8 (clang)
  ok    opt          22.1.8 (opt)
  ok    milo         pinned ba9484985954
  ok    hello world  compiled and ran

all checks passed
```

## Commands

```sh
bin/chad check file.ts            # typecheck + subset check only, no binary
bin/chad build file.ts -o out     # native binary
bin/chad run file.ts [args...]    # build to a temp dir and run
bin/chad doctor                   # check the toolchain
bin/chad --version                # chad 2.0.0-alpha.1 (milo <pinned commit>)
```

## What "subset" means

The compiler runs tsc at maximum strictness first; a program with any type error is not
compiled. Then the compiler admits only constructs on an explicit list, each backed by a test
that runs the program under Node and natively and compares the output.
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
`===`, `instanceof`, `Array.isArray` and truthiness, spread, try/catch/finally with `Error`,
`TypeError`, `RangeError` and `SyntaxError`, async/await with `new Promise`, timers, `String()`
and template literals of any supported value, `node:fs` (sync and promises), `node:path`,
and multi-file ES modules (named, default and namespace imports, re-exports, specifiers as
TypeScript writes them, npm packages that ship TypeScript source).
The generated [`docs/SUBSET.md`](docs/SUBSET.md) is the exact list.

Not supported, by design: `any`, `eval`, prototype mutation, adding or deleting properties at
runtime, CommonJS, packages that ship only JavaScript. Programs that need those should run on Node (or
[milojs](https://github.com/milo-language/milojs)); since every accepted program is valid
TypeScript, the same file runs there unchanged.

Not supported yet: regular expressions, `Date` objects (only `Date.now()`), optional and default
parameters, getters and setters, `.then()` on promises (use `await`), classes that extend `Error`,
generics instantiated with arrays, maps or functions (wrap them in an object), optional chains
longer than one `?.`, operations on an un-narrowed union beyond printing, `===`, `typeof`, `??`
and truthiness (narrow it first), and `Map`/`Set` keyed by a union. The known limitations of
this release are listed in [`CHANGELOG.md`](CHANGELOG.md).

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

- **[cs01.github.io/ChadScript](https://cs01.github.io/ChadScript/)**: the documentation site
  (getting started, language guide, subset and error reference, internals, benchmarks). Every
  code sample on it is compiled and diffed against Node by `tests/slow/docs-examples.test.ts`.
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
