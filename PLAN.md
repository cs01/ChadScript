# ChadScript plan

The one charter. Mission, contract, architecture, phases. `CLAUDE.md` holds the working rules;
`docs/SUBSET.md` (generated) is what the compiler accepts today. Nothing else is authoritative.
Superseded plans and reviews were deleted on 2026-09-22; recover them from git history.

## Mission

Compile ordinary, statically analyzable TypeScript ahead of time to small native binaries.

- **Accepted programs behave exactly like Node.** Same stdout, same exit code.
- **Everything else is rejected at compile time** with a `CS####` code, a span, and a rewrite
  suggestion. There is no third category ("compiles but diverges"): that is a P0 bug.
- **Real programs are multi-file.** `import`/`export` across files is a first-class feature,
  not a single-file toy.

Product: CLI tools and services as a ~100 KB binary with ~2 ms startup (today:
`examples/shapes.ts` builds to 94 KB plus libgc and runs in ~2 ms vs ~48 ms under Node). The
same source also runs on Node (or [milojs](https://github.com/milo-language/milojs)), so rejection
never strands a program.

## Non-goals (permanent)

- A JS engine. No `eval`, prototype mutation, property add/delete, `Proxy`, getters on
  literals. Programs that need dynamic JS run on Node or milojs.
- Custom type inference or a custom parser. tsc does both.
- Self-hosting. The compiler runs on Node (via bun) forever.
- npm compatibility as a goal. A package works iff its **TypeScript source** is in the subset.
- CommonJS and `require`. ESM only.

## Constitution (never violate)

1. **tsc is the type oracle.** Programs must typecheck at max strictness (`strict`,
   `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
   `noPropertyAccessFromIndexSignature`) with zero diagnostics. We never infer a type.
2. **Default-deny validator.** A construct is admitted only by an explicit allowlist rule
   with a passing differential fixture. Anything unconsidered fails closed.
3. **Sema before codegen.** Every HIR node carries a `ValueType` before the backend runs.
   Only `src/lower/` imports TypeScript (a test enforces it). Codegen never infers; a
   missing fact is an `ice()`.
4. **Node is the semantics oracle.** Tests diff native stdout + exit code against Node at
   `-O0` and `-O2`; the IR passes `opt -passes=verify`. No self-reporting fixtures.
5. **No silent anything.** Discriminated dispatch is `switch` + `never` + throwing default.
6. **Representation belongs to the value, not the static type.** TypeScript is structural and
   unsound; its types choose _optimizations_, never _layout correctness_. (Added 2026-09-22;
   see "Why the value model changes".)

## Why the value model changes

Until now, object layout was derived from the static type: a closed shape, field _i_ at slot _i_.
tsc happily passes a `{y, x}` where a `{x}` is expected, so the callee read the wrong slot:

```ts
interface P {
  x: number;
}
function f(p: P): number {
  return p.x;
}
const q = { y: 2, x: 5 };
console.log(f(q)); // node: 5, chad (2026-09-22): 2
```

Same root cause, all reproduced 2026-09-22: a class instance and a literal in one `HasB[]`
(wrong output), two interfaces with reordered fields aliasing one object (wrong output),
discriminated unions (ICE), optional fields read through a `Map` value (ICE). And it is why
generics, mixed unions and interface method calls could never be admitted cleanly: each one
fights the layout assumption. That is the "every fix fails" pattern of the previous attempts.

## Value model (target)

1. **Shaped objects.** Every object starts with a pointer to an immutable runtime shape
   (field name to slot, method name to function, per-slot pointer map for the GC). Class
   instances and literals share the model. Shapes never change after allocation, because
   the subset forbids property add/delete.
2. **Static field access wherever possible.** The program is closed-world, so the compiler
   knows every allocation shape assignable to each static type. If one shape reaches, or all
   reaching shapes put `x` at the same slot (whole-program field ordering), `p.x` is one load.
   Otherwise a per-site inline cache: compare shape pointer, load; miss goes to a shape lookup.
3. **`Value` (NaN-boxed u64)** only where the static type is a union of different
   representations, a type parameter, or `unknown`. `number`, `string`, `boolean` stay
   unboxed. Narrowing (`typeof`, literal discriminant, `instanceof`, `in`) is a tag test.
   NaNs are canonicalized before boxing.
4. **Generics by erasure** to `Value`. Monomorphization later, as a flag-off optimization.
5. **Mutable captures** live in heap cells.
6. **TS soundness holes closed in the validator:** no `any`, no narrowing `as`. `x!` is erased
   exactly as Node erases it (no runtime check, which would diverge), so it is admitted only
   where it changes no representation; elsewhere it is rejected.

What remains "runtime" is shapes, the inline cache, and NaN-box helpers: ~1-2k LOC of C.
There is no parser, interpreter, JIT, or deoptimizer in the binary.

## Modules

Programs are directory trees of `.ts` files. Target surface:

- Named, default, and namespace imports and exports; `export { x as y }`; re-exports
  (`export * from`, `export { x } from`).
- Specifiers as TypeScript writes them: `./util`, `./util.js`, `./util.ts`, `./dir/index`.
  Resolution is tsc's (`moduleResolution: bundler`), never ours.
- Namespace imports (`import * as u`) lower to static symbol references; using the namespace
  as a first-class value is rejected.
- Builtins as modules: `node:fs`, `node:fs/promises`, `node:path`, `node:process`, with named,
  default and namespace forms.
- Packages: a bare specifier that resolves to **TypeScript source** in `node_modules` is
  compiled like user code, whole-program. One that resolves only to `.js` + `.d.ts` is rejected
  with a diagnostic naming the package and suggesting `--fallback=node`.
- Module scoping: every top-level symbol is namespaced by module in the IR; module
  initialization runs once, in dependency order, cycles rejected until a fixture needs them.
- `require`, `module.exports`, dynamic `import()`: rejected with the ESM rewrite as the hint.

## Architecture

```text
.ts tree ──tsc (types, resolution)──▶ validate (default-deny) ──▶ lower ──▶ HIR (typed)
        ──▶ verifyHir ──▶ codegen ──▶ typed IR builder ──▶ clang ──▶ binary + runtime
```

- `src/frontend` tsc program + module graph. `src/validate` allowlist + `CS####` codes.
  `src/lower` the only tsc consumer. `src/hir` typed nodes + verifier. `src/codegen` HIR to IR.
  `src/ir` typed LLVM IR builder (raw IR text is banned outside it). `src/driver` clang/link.
- `runtime/` Milo (`runtime/*.milo`, one compilation unit rooted at `lib.milo`) plus the C residue
  `runtime/residue.c`. `stdlib/globals.d.ts` the ambient environment programs see (no `@types/node`).

### Memory: our own GC in Milo (phase 6)

Boehm is conservative everywhere, non-moving and allocates through a library call; it forced the
fiber-stack rooting hack and is slow on allocation-heavy code.

Revised 2026-09-23: exact stack roots (shadow stacks or statepoints) are out. The runtime is Milo
code that holds raw heap pointers in its own frames across allocations, and the Milo compiler
emits no stack maps, so an exact root set is not available without instrumenting Milo itself.
Design instead: **conservative roots, precise heap.**

- Roots: the machine stack, every fiber stack, registers (via setjmp spill), and registered data
  ranges (globals, shape constants), scanned conservatively. A word is a candidate if it points
  into an allocated object after masking the Value tag bits.
- Heap: every object has a header naming its layout (shape for records, element kind for arrays,
  atomic for strings and number buffers, descriptors for closure envs, cells, map/set tables,
  promises, runtime structs). Marking follows exactly those pointer slots, never guesses.
- Allocation: Immix-style blocks and lines with a bump-pointer fast path inlined into generated IR;
  lazy sweep of free lines. Non-moving first; opportunistic evacuation of objects not pinned by a
  conservative root is a later, flag-gated optimization.
- Gates: `CHAD_GC_STRESS=1` (collect every N allocations) over the full differential suite, the
  ASan lane, and benchmarks including an allocation-heavy one (binary trees).
- No-GC ownership is not an option: TS programs alias and form cycles freely.

### Runtime language: Milo

The runtime is written in [Milo](https://github.com/milo-language/milo) (phase 2 ported the
~2.9k LOC of C), and new runtime code is Milo from the start. The compiler commit is pinned in
`scripts/milo-pin.sh`; `scripts/setup-milo.sh` fetches it into `.milo/` (or `CHAD_MILO` names
another checkout). The driver runs `milo emit-ir` on `runtime/lib.milo` and compiles the IR with
the same clang and flags as the C residue, into one content-addressed cached object. Why Milo:

- Runtime memory bugs are a live bug class here (9bb8916d fixed a dangling `CsString` in
  `cs_new_error`), and Milo's second-class references rule that class out in safe code.
- Milo has what a runtime needs at the seam: `@externalLinkage` functions with fixed C
  symbols, `extern struct` layouts, `cfn` function pointers (for `makecontext` and callbacks),
  raw `*u8` inside `unsafe`, `(ptr, len)` views via `std/foreign`, and `std/fs`, `std/json`,
  `std/http` to build the library layer on.
- Milo emits LLVM IR, so runtime and program can be linked as one module (`llvm-link`) and
  LTO can inline hot runtime helpers into generated code. C `.o` files never allowed that.

Split inside the Milo runtime:

- **Core, in `unsafe` Milo:** object header + shapes, `Value` tags, IC miss path, GC (Boehm
  via `extern` until the precise GC, which is then written in Milo), fibers (`ucontext` via
  `extern`), exception unwinding. These are layouts the generated IR reads directly, so they
  are specified once as `extern struct`s and a test checks the IR builder's view against them.
- **Library, in safe Milo:** number formatting / dtoa, strings, JSON, path, fs, process,
  timers, later http. Nothing here holds a GC pointer across a call it does not own.

C that remains (`runtime/residue.c`, ~20 lines of code), each item commented with why:
`GC_INIT` (a C macro); the `cs_undefined_marker`/`cs_null_marker` globals whose addresses
generated IR compares against (Milo cannot define or address a named data symbol); accessors for
`stdout`/`stderr` (data symbols, `__stdoutp` on macOS); a static assert that `jmp_buf` fits the
512 bytes `errors.milo` reserves; and `getcontext`/`makecontext` setup for fibers (the
`ucontext_t` layout is platform specific). `_setjmp` is called from generated IR directly (it
returns twice, so never through a wrapper); `_longjmp` and `swapcontext` are called from Milo. A
throw that escapes an async body no longer needs a setjmp root handler: `cs_throw` with an empty
handler stack rejects the running fiber's promise and switches away. Coverage: the sanitized lane
builds the Milo runtime with `--sanitize` (ASan); UBSan checks come from clang's C frontend, so
Milo code is not UBSan-instrumented (Milo traps integer overflow itself). Globals in runtime Milo
code must have constant initializers: Milo's `global_init` only runs from a Milo `main`, and the
driver refuses a runtime that needs one.

Preconditions: pin the Milo compiler commit in the repo and build it in CI (Milo moves fast;
`docs/breaking-changes.md` there is the upgrade checklist). Before porting, a spike proves the
seam: one Milo function taking and returning `CsString {ptr, len}` by value, called from
generated IR at O0 and O2 on macOS arm64 and Linux x64, ASan clean. If by-value struct ABI or
`cfn` breaks, that is a Milo bug to fix in Milo, not a reason to keep C.

milojs (the JS engine written in Milo) is separate: it is a fallback target for programs outside
the subset, and it may share library modules (dtoa, JSON) with this runtime. No shared heap.

Not options: compiling TS to Milo _source_ (TS aliasing does not fit Milo ownership, and we would
lose control of layout and GC roots); writing the compiler in Milo (tsc is the oracle).

## Testing

- Fast lane (`bun run test`, under 10 s) runs locally on every change; `tests/slow/`
  (differential, fuzz, C runtime) runs in the background or in CI, never blocking.
- `tests/fixtures/run/**`: differential, run under Node and native at O0 and O2, stdout + exit
  code diffed; a multi-file fixture is a directory with `main.ts`.
- `tests/fixtures/reject/**`: `// @expect-reject: CS1234`, must fail with that code.
- Every validator rule has a rejection fixture; every admitted construct a differential one.
- `tests/unit`: IR builder, HIR verifier, architecture walls, runtime C tests.
- Seeded fuzzer over the accepted grammar. Phase 0 adds a structural-subtyping fuzzer.
- `tests/dod-manifest.ts`: the definition of done as data, each `done` item citing fixtures.
- Sanitized lane (`bun run test:san`): ASan + UBSan over the whole suite.
- `scripts/bench.ts` + `benchmarks/`: native vs Node timings.

## Phases

Each phase: fixtures first, all gates green, then stop and record the outcome in the DoD
manifest. Estimates in LOC.

0. **Gates.** The value-model probes above as fixtures (marked expected-fail until phase 3).
   Structural-subtyping fuzzer: random interfaces, literals and classes with reordered and
   extra fields, cross-assigned, read and written through each type; it must reproduce the
   miscompiles on today's compiler. Fix the differential suite's 60 s timeout. (~400)
1. **Modules.** DONE (dod `modules`; `node:process` as a module is still open). The full "Modules" surface above, including default/namespace imports,
   extensionless and `.js` specifiers, re-exports, `node:*` default imports, TS-source
   packages, and CommonJS rejections. Independent of the value model, and it unblocks writing
   real multi-file programs as tests. (~600)
2. **Runtime to Milo.** DONE (dod `runtime-milo`). Every module is Milo; the C residue is
   `runtime/residue.c` (see "Runtime language: Milo" for what it holds and why). Plan as run: seam spike first (above), then port `runtime/*.c` file by file,
   leaf modules first (`path`, `number`, `string-methods`, `json-parse`), `async` last. Pure
   refactor under an unchanged differential suite, done before new runtime code exists so
   shapes and `Value` are born in Milo. Exit: C residue under 100 lines, all lanes green,
   benchmarks no worse. (~3k Milo)
3. **Shaped objects + static field ordering + inline caches.** DONE (dod `shaped-objects`).
   Every record is `[*CsShape, field Values...]` (runtime/abi.milo); one shape per allocation
   layout (class, literal field list, spread result, JSON.parse target) carrying field names and
   kinds, class name, method table, and the per-shape print/JSON functions. Field slots hold
   `Value`s (src/codegen/value.ts: numbers offset by 2^49, pointers raw with a 3-bit tag so Boehm
   still sees them, `undefined` = 0). `lower/layouts.ts` computes, per static type, the layouts
   whose allocating type is assignable to it; a site whose reaching layouts agree is one static
   load, otherwise a per-site inline cache with a by-name miss path (runtime/shape.milo). Literals
   allocate exactly their own properties in JS order; spreads dispatch on source shapes; method
   calls through interfaces dispatch by name to class methods or function fields; console.log,
   JSON.stringify and Object.keys/values read the runtime shape. Unions of object types are one
   object type over their common fields. New rejections: CS1235 (property add), CS1236 (spread or
   Object.values over too many or mixed layouts), CS1237 (method implementations with other
   machine types than the call). JSON.parse objects get a runtime shape derived from a per-type
   template (key order and present keys from the JSON text, cs_json_object), so their layouts
   never agree on a static slot; a spread over one is CS1236, a write that could add an absent
   optional key CS1235 (an undeclared key is kept since phase 4). Not yet: optional chains longer than one
   link. (~1.5k)
4. **`Value`, unions, narrowing.** DONE (dod `value-unions`). A union of different
   representations is one Value word in every position (locals, params, returns, array elements,
   Map values, fields); boxing and unboxing are explicit HIR nodes (`box`/`unbox`) checked by
   verifyHir, and lower unboxes wherever tsc's narrowed type at a use has one representation.
   `typeof`, `===`, `instanceof`, `Array.isArray`, truthiness and `switch` narrow; printing,
   `String()`, templates, `===` (SameValue on the words), `typeof`, `??` and JSON work on an
   un-narrowed Value, anything else is CS1239. Array covariance across representations is CS1240;
   CS1233 now only covers unions no Value can tell apart (two array types) and union Map/Set keys.
   A field write through a wider static type widens the reaching shapes' field types. JSON.parse
   keeps undeclared keys as Value words (printed, serialized, listed like Node). Union fuzzer in
   tests/slow. (~2.5k)
5. **Mutable captures and erased generics.** DONE (dod `captures-generics`). A local that a closure
   captures and anything reassigns lives in a GC heap cell shared by the frame and every closure;
   `for (let ...)` and `for...of` give each iteration its own cell (per-iteration copy before the
   update), and variables never reassigned are still captured by value (same IR as before). CS1219
   is retired; CS1241 rejects a narrowed read of a multi-representation cell after a call, where
   tsc's narrowing can be stale. Generics compile once per declaration with each type parameter a
   Value word (or its constraint's representation); calls convert at the boundary using the
   declaration's signature against tsc's resolved one (box/unbox, array literals built in Value
   slots, closures adapted, fresh result arrays copied) and reject what cannot cross: containers or
   functions as type arguments (CS1242), aliased containers of other representations (CS1240),
   type-level computation (CS1243), constructor types (CS1244). `x!` is admitted where it is a
   no-op on a Value word. Closures + generics fuzzer in tests/slow. (~1.6k)
6. **Own GC** in Milo (conservative roots, precise heap, inline bump allocation); drop libgc. (~2k)
7. **0.1 "TS CLI tools"**: argv, fs, JSON parsed and validated against the declared type,
   async, `chad run --fallback=node|milojs`, generated SUBSET.md, release binaries.

## Decisions locked

- Strings are UTF-8 `{ptr, len}`. JS-exact for ASCII; every operation whose result depends on
  UTF-16 code units is gated until the Unicode decision.
- `==`/`!=` rejected; use `===`/`!==`.
- `JSON.parse` validates against the declared type and throws on mismatch; no `any` exists.
- Numbers cross the C ABI as `double`, never `int`/`long`.
- Whole-program compilation from one entry file.
- `Value` is NaN-boxed (slots are already 64-bit), in the pointer-favoring variant: doubles are
  offset by 2^49 and pointers stay raw with a low 3-bit tag, because Boehm cannot see a pointer
  hidden under NaN tag bits (src/codegen/value.ts).

## History

- **v1** (`main`, ~88K LOC, dead): types were resolved during codegen against a mutable symbol
  table, so nothing could be computed ahead of time; every fix destabilized self-hosting.
  Lesson: types fully resolved before the backend.
- **hir** (`~/git/hir`, stalled 2026-05): everything NaN-boxed, chased prototype chains and
  lodash coverage. Lesson: bounded scope; dynamic JS belongs to an engine.
- **v2, July 2026** (this branch): right pipeline, wrong value model (layout from static type).
  Lesson: constitution rule 6.
