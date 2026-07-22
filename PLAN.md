# ChadScript v2 — Static TypeScript Subset Compiler

Charter for the from-scratch rewrite: a **principled, statically analyzable subset of
TypeScript** compiled AOT to native binaries. This document is the implementation plan for
Opus-class agents. Read it fully before writing code. `CLAUDE.md` holds the standing rules;
this file holds the mission, the language contract, the architecture, and the phase plan.

**Repo strategy:** this lives on the `v2` branch of the ChadScript repo. `main` is the dead
v1 compiler — never land work there. Commit directly to this branch and push; no PRs
required. The branch keeps v1's salvageable assets in-tree (see "Kept in-tree" below);
everything being reimplemented was deleted in the branch's first commit — recover any v1
code via `git show main:<path>`.

## Mission

Every accepted program behaves **exactly** like Node runs it. Every program outside the
subset is **rejected at compile time** with a precise diagnostic and a suggested rewrite.
There is no third category. "Compiles but behaves differently than Node" is the defining
failure of the predecessor and is treated as a P0 bug, always.

## Non-goals (permanent)

- **Self-hosting.** The compiler runs on Node forever. Both predecessors proved the
  bootstrap trap: every codegen bug becomes a stage1/stage2 segfault archaeology session.
- **Full JS semantics.** No prototype mutation, no `eval`, no monkey-patching, no `Proxy`.
  We are not building a slow V8. Programs that need dynamic JS should run on Node.
- **npm compat as a goal.** A package works iff it happens to fit the subset. We do not
  chase lodash coverage percentages (this is where hir lost the thread).
- **A custom parser or a custom type checker.** See "tsc is the oracle" below.

## Post-mortem: why the predecessors died (and what each lesson buys us)

### ChadScript v1 (this repo's `main`, ~88K LOC TS, dead)

1. **Types were resolved during codegen.** The mutable `SymbolTable` was populated as
   codegen ran, so expression types could not be computed ahead of time. The salvage
   audit measured it: `member_access` was ~100% annotation-cache miss across 648 fixtures;
   every attempt to pre-compute (issues #658/#662–#666) segfaulted self-hosting and was
   reverted. See `docs/tranche3-abort-decision.md` — the incremental fix was formally
   judged walled. **Lesson: types are fully resolved before the backend starts, or the
   architecture is unsalvageable later.**
2. **Semantics enforced by honor system.** "Patterns That Crash" was prose in CLAUDE.md:
   closures captured by value (a semantic lie patched with a checker), `|| {literal}`
   produced garbage reads, stack structs escaped into fields. Accepted programs were
   silently wrong. **Lesson: if the compiler can't do it correctly, it must reject it.**
3. **LLVM IR emitted as string concatenation.** Unverified IR, `inttoptr i64 0` fallbacks
   that -O2 exploited as UB, parallel bookkeeping arrays to track terminators.
   **Lesson: typed IR builder with structural invariants + mandatory verification.**
4. **Custom parser + custom type inference** consumed the majority of the 88K LOC and
   produced the majority of the bugs — all reinventing what `tsc` already does.
5. **Differential testing arrived last instead of first.** The salvage tranche's
   Node-oracle harness + seeded fuzzer immediately found real miscompiles (integer
   narrowing broke `Math.ceil` on params; `toString(radix)` ignored the radix;
   `Infinity` printed as C's `inf`). **Lesson: diff-vs-Node is the default test type
   from commit 1.**

### hir (`~/git/hir`, the first rewrite, stalled 2026-05)

Right calls, keep them: SWC-class off-the-shelf parser, no self-hosting, tests diff
stdout against Node, small modular codebase, C runtime bridges, Boehm GC.

Wrong call, avoid it: **NaN-box-first dynamic semantics.** Chasing prototype chains,
`Object.defineProperty`, `this`-binding, and lodash compat is reimplementing V8 slowly —
an unbounded goal with no principled stopping point. Momentum died there.

**Synthesis: v1 failed on architecture, hir failed on scope. v2 takes hir's hygiene and
replaces the open-ended dynamic goal with a hard static contract.**

## Design principles (the constitution)

1. **tsc is the type oracle.** The frontend is the official TypeScript Compiler API.
   A program must typecheck under maximum strictness (`strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`)
   with **zero diagnostics** before we look at it. We never write type inference. The
   checker's answer for every expression is recorded into our IR. This deletes the entire
   bug class that killed v1 and the biggest LOC sink of both predecessors.
2. **Reject, don't approximate.** The subset validator is a first-class product surface.
   Every rejection has: an error code, the offending span, a one-line reason, and where
   possible a suggested rewrite ("`==` is not supported; use `===`"). Every rejection
   rule ships with a fixture proving it fires.
3. **Sema before codegen, totally.** After validation + lowering, every HIR node carries an
   interned `TypeId`. The backend contains **zero** type inference and throws (never-typed
   `ice()`) on any missing annotation. Codegen is mechanical; all intelligence lives in
   passes that run before it.
4. **Node is the semantics oracle.** The default test asserts
   `stdout(native binary) === stdout(node)` on the same source. Divergence = failure.
   No `TEST_PASSED` self-reporting fixtures.
5. **No silent anything.** Discriminated dispatch is `switch` + exhaustive `never` check +
   `throw` default. No fallback paths that emit null pointers, no default LLVM types, no
   "probably i8\*". An unhandled case is a loud ICE, not garbage IR.
6. **Small files, mechanical structure.** No file over ~800 lines. New feature = new file.
   The 133KB monolith is a documented cause of death.
7. **JS semantics exactly, or rejection.** Where we support a construct, we match Node:
   f64 numbers, int32 bitwise (JS masks shift counts to 5 bits and truncates operands to
   int32 — adopt wholesale on day 1, this was v1's last open silent divergence),
   JS truthiness, `undefined` vs `null` distinct, closure capture **by reference**,
   `Infinity`/`NaN` spellings, `util.inspect`-compatible `console.log` for supported types.

## Decisions locked (2026-07-21)

- **Hard sema/backend separation from commit 1 (the core discipline this rewrite exists to
  enforce).** Three walls, structural not conventional:
  - `lower/` is the ONLY place that imports `ts` and touches the `TypeChecker`. It walks the
    tsc AST and produces HIR, stamping every node with its resolved type (from the checker).
  - `hir/` nodes carry their resolved type. HIR does not reference `ts` at all.
  - `codegen/` consumes HIR and emits IR. It MUST NOT import `ts` or the checker — the backend
    has no oracle to reach for; a HIR node missing its type is an `ice()`, not a lookup.
    This is enforced by a test that fails if `codegen/` or `hir/` imports `typescript`. v1 died
    because the type/codegen boundary was a convention that eroded under a mutable SymbolTable;
    here it is a wall built while the surface is tiny (cheapest to get right, impossible to rot).
    Full canonical `TypeId` interning (a global type table) is a separate, genuinely deferrable
    optimization — the resolved-type annotation on HIR nodes starts as a small semantic
    `ValueType` and grows into an interned table when passes over HIR demand it. The SEPARATION
    is not deferred; only the interning table is.
- **The validator is default-DENY (allowlist).** This is what makes the subset a real
  definition instead of prose. The validator walks every AST node kind and every type the
  checker reports; a construct is admitted **only** if an explicit ALLOW rule handles it,
  and every ALLOW rule ships with ≥1 passing differential fixture. Anything else is
  rejected with `CS####` + span + "not in the subset (yet)". Consequence: **the subset is,
  at every commit, exactly the set of constructs with a passing differential fixture** —
  there is no fuzzy middle where an un-considered construct reaches codegen. This is the
  precise inversion of v1's default-allow-then-segfault. The accepted/rejected lists below
  are the _roadmap_ for which ALLOW rules to write, in what order — not the definition.
  The definition is the allowlist in code. A phase "adds to the subset" by adding ALLOW
  rules + fixtures; it can never do so by omission.
- **Strings are UTF-8** internally, `{ptr, len}` layout. Semantics are JS-exact for ASCII;
  the fuzzer generates ASCII-only strings until this is revisited (Phase 4) — at which
  point either `length`/`charCodeAt`/index get code-unit-exact UTF-16 semantics or the
  divergence gets documented + validator-gated (e.g. reject `charCodeAt` on non-ASCII-
  provable strings). Do not silently diverge in the meantime.
- **`==` and `!=` are rejected entirely.** Use `===`/`!==`. Simpler than a same-type
  carve-out, and strictly analyzable.
- **`JSON.parse` validates at runtime against the declared type.** `JSON.parse<T>(s)` (or
  contextual typing) emits a shape validator for `T`; mismatch throws a clear error.
  No `any` result ever exists.
- Boehm GC. Whole-program compilation from one entry file. ESM only.

## The language contract (v1 of the subset)

Input: ESM TypeScript, whole-program compilation from one entry file. `tsconfig` is owned
by the compiler (max strictness, non-negotiable).

### Accepted

- Primitives: `number` (f64), `boolean`, `string`, `null`, `undefined`, literal types.
- All arithmetic/comparison/logical ops with JS semantics; bitwise ops with JS int32
  semantics; `===`/`!==` only.
- Control flow: `if`/`else`, `while`, `do`, `for`, `for...of` (arrays, strings, Map, Set),
  `switch`, labeled break/continue, ternary, `&&`/`||`/`??` with JS value semantics.
- Functions: declarations, arrow functions, closures (capture by reference — mutable
  captures are boxed), default params, rest params, overload-free generics.
- Objects: object literals against a declared interface/type — **closed shape**, fixed
  layout. Optional properties (`x?: T`) as tagged presence. Readonly.
- Classes: fields, methods, constructors, `extends` (single), `implements`, `private`/
  `protected`/`public`, static members, getters/setters on classes only. Nominal layout,
  vtable dispatch.
- Interfaces: structural at check time (tsc's job); at runtime, values used at interface
  type get a fat pointer (data + itable). Details in Phase 3.
- Unions: `T | null | undefined`, discriminated unions of object types (tsc narrows;
  we compile the narrowing), unions of literal types. Represented as tagged values.
- Generics: functions and classes, compiled by **monomorphization** (depth cap with a
  clear diagnostic on explosion). No `keyof`-metaprogramming beyond what resolves to a
  finite literal union at compile time.
- Enums: `const enum` only (inlined literals). Regular `enum` rejected (suggest
  `as const` object — carry over v1's rule).
- Built-ins (phased): `console`, `Math`, `JSON`, `Array`, `Map`, `Set`, string methods,
  `Number`, `Object.keys/values/entries` (on closed shapes — statically known),
  template literals, spread of arrays/args, destructuring, optional chaining `?.`,
  `throw` (Phase 1: terminates process with Node-identical message; try/catch Phase 5).
- Modules: static ESM `import`/`export` only; per-module scoping in the IR (v1's flat
  merge caused builtin/user name collisions — namespace all symbols by module).

### Rejected (each with error code + suggested rewrite)

- `any`, bare `unknown` escaping a narrowing context, `as any`, `@ts-ignore`,
  `@ts-expect-error`, non-null `!` (use explicit checks), `as` casts that aren't
  upcasts/const-assertions, `==`/`!=`.
- `eval`, `new Function`, `with`, `arguments`, `Proxy`, `Reflect`, `Symbol` (except
  `Symbol.iterator` internally, later), prototype access/mutation of any kind, `delete`,
  dynamic property add/remove, index signatures `[k: string]: T` (use `Map`),
  getters/setters on object literals, `Object.defineProperty`.
- Declaration merging, namespaces, decorators, `abstract` (initially), mixins,
  `instanceof` on interfaces, `typeof x` value-tests except where tsc uses them to narrow
  a union we support.
- Sparse arrays, array holes, `Array(n)` without fill, heterogeneous arrays without a
  declared union type.
- `async`/`await`/Promises/generators/iterator-protocol customization — until Phase 6.
  try/catch/finally — until Phase 5. Regex — until its phase (c_bridges/regex-bridge.c
  is the salvage).
- Dynamic `import()`, `require`, CJS.

The contract grows monotonically: constructs move rejected→accepted, never the reverse,
and only with full differential coverage.

## Architecture

```
entry.ts
  → tsc Program (parse + typecheck, zero-diagnostic gate)          src/frontend/
  → Subset validator (AST + checker walk; reject or admit)        src/validate/
  → Lowering to HIR (tree, every node stamped with TypeId          src/lower/
     from an interned TypeTable; module-namespaced symbols)
  → Passes over HIR/MIR                                            src/passes/
     monomorphize → devirtualize → narrowing-to-i32 (opt-in,
     fuzzer-gated) → layout (struct/vtable/itable tables)
  → Codegen: typed IR builder → LLVM .ll text                      src/codegen/
  → clang -O2 link with runtime                                    src/driver/
runtime: small C library (strings, arrays, map/set, format,       runtime/
     Boehm GC), `cs_` prefix (kept from v1), double ABI for JS numbers
```

Implementation language: **TypeScript on Node** — forced by the tsc-API frontend, and
fine because we never self-host.

Backend choice: emit **.ll text via a typed builder**, not string concat and not the LLVM
C API (yet). The builder is the guardrail: values are `{name, type}` records, a
`BasicBlock` object requires exactly one terminator (enforced by construction, not by a
parallel bookkeeping array), function emission fails loudly on an unterminated block.
Every compile runs `clang`-side verification; CI additionally runs `opt -passes=verify`
on every fixture's IR at -O0 **and** -O2. Moving to the LLVM C API is a possible later
optimization, not a Phase-0 dependency (`git show main:c_bridges/llvm-bridge.c` if so).

## Testing strategy (built in Phase 0, before any codegen)

1. **Differential runner** (the default): fixture `.ts` → run under Node, compile with
   v2, diff stdout + exit code. Auto-discovered from `tests/fixtures/**`, no registry.
2. **Rejection fixtures**: `// @expect-reject: CS1234` — compile must fail with that
   code and a span. Every validator rule has ≥1.
3. **Seeded fuzzer**: grammar-based generator over the _accepted_ subset, differential
   against Node. Grows with each phase's grammar. Nightly long runs; 300-case smoke in CI.
   (v1's fuzzer found real miscompiles within days of existing — it goes in first, not last.)
4. **IR verification**: `opt -passes=verify` on every fixture, -O0 and -O2.
5. **-O0 vs -O2 output diff**: any behavioral difference between opt levels = UB leak = P0.
6. Optimization passes (narrowing, devirt) each land **off by default** behind a flag,
   fuzzer-gated, flipped on only after N clean nightly runs.

## Phase plan

Each phase = a sequence of agent-sized commits. **Gate to exit a phase: all differential
fixtures green, all rejection fixtures green, fuzzer clean over the phase's grammar,
`opt -verify` clean.** LOC are estimates for planning, not quotas.

> **Status (2026-07-22, 256 tests green):** Phases 0–2 DONE. Phase 3 mostly done (closures,
> nullable/tagged-`T|null|undefined`, classes with vtable virtual dispatch + `instanceof`;
> interfaces = plain object shapes, no itable fat-pointers yet; generics NOT done, treated as
> optional per user). Phase 4 partial (Map/Set, Math.\*, Number/String conversions, many string
> methods, `console.log` util.inspect done; JSON/Date/fs/process NOT done). **Phase 5 (errors) is
> next — user requires try/catch/throw + Phase 6 async before "done".** `toString(radix)` done;
> `toFixed` deferred (needs JS dtoa).

### Phase 0 — Skeleton + oracle harness (~3K LOC)

- New `package.json`/`tsconfig.json` for the compiler itself (strict), prettier, CI
  (mac + linux) — replacing the deleted v1 build config.
- tsc frontend: load program, enforce zero-diagnostic gate, walk API surfaced cleanly.
- Validator skeleton + first 10 rejection rules (`any`, `eval`, `enum`, `==`, index
  signatures, …).
- Differential test runner + rejection runner + fixture auto-discovery.
- Typed IR builder core (values, blocks, terminator discipline) with unit tests — no
  real codegen yet, just `main` returning an exit code end-to-end through clang.
- Runtime stub + build script (`runtime/`, Boehm vendored via `scripts/build-vendor.sh`,
  trimmed to what v2 needs).
- **Exit demo**: `console.log("hello")` + exit codes, diffed against Node, both OSes.

### Phase 1 — Scalars + control flow (~4K LOC)

- number/boolean/string/null/undefined; all operators incl. int32 bitwise; template
  literals; truthiness; `&&`/`||`/`??` value semantics; if/while/for/switch/labels.
- Functions + calls (no closures yet), default/rest params.
- Runtime: number formatting **exactly** matching Node (shortest-roundtrip f64 — port
  or bind a ryu/grisu implementation; v1's printf approach diverged), string basics,
  `console.log` for scalars.
- Fuzzer grammar v1 (expressions + control flow). This phase is where the fuzzer earns
  its keep — v1's narrowing bugs were exactly here.

### Phase 2 — Data: arrays, objects, classes (~5K LOC)

- `T[]`: layout per element type, literals, index (with `noUncheckedIndexedAccess`
  semantics: OOB read is `undefined`, tsc already forces callers to handle it), push/pop/
  slice/length/for...of, spread.
- Closed-shape objects from interfaces/type literals; optional props; readonly.
- Classes: layout, ctor, methods, `extends`, vtables, `instanceof` (classes only),
  getters/setters, statics, visibility (compile-time only).
- Destructuring (array + object), `Object.keys/values/entries` on closed shapes.
- `console.log` structural formatting matching `util.inspect` for supported types.

### Phase 3 — Closures, unions, interfaces, generics (~5K LOC)

- Closures: environment records, capture by reference, mutable captures boxed. JS
  semantics — no capture-by-value checker hacks.
- Tagged unions: `T | null | undefined`, discriminated object unions, literal unions;
  compile tsc's narrowing (the checker tells us the narrowed type per branch — trust it).
- Interface-typed values: fat pointer {data, itable}; itables built at layout time per
  (class, interface) pair actually used.
- Monomorphization pass for generic fns/classes; depth cap diagnostic.

### Phase 4 — Stdlib breadth (~4K LOC + C runtime)

- String method set (v1's fixtures are the menu; runtime in C, `{ptr,len}` discipline).
  Revisit the UTF-8/unicode decision here with real fixtures.
- `Map`/`Set` (typed specializations), `Math.*`, `Number.*`, `JSON.parse/stringify`
  (salvage `c_bridges/yyjson-bridge.c`; parse validates against declared type per the
  locked decision above).
- `process.argv/env/exit`, minimal `fs` (readFileSync/writeFileSync) to make the tool
  usable for real CLI programs.

### Phase 5 — Errors (~2K LOC)

- `Error` classes, `throw`/`try`/`catch`/`finally` via proper unwinding (Itanium ABI
  through clang; `invoke`/`landingpad` in the builder). Until this phase `throw` is
  compile-accepted but terminates (Node-identical message + non-zero exit).
- Stack traces: best-effort (function names, no line info initially).

### Phase 6 — Async (~5K LOC, design doc first)

- `async`/`await`/`Promise` subset on libuv; CPS or state-machine transform in HIR
  (design doc + review gate before implementation). Timers, `fs/promises` subset.
- This unlocks "real tool" territory; do not start before Phases 0–5 are boring.

### Continuous (any phase)

- Benchmarks vs Node + Bun on numeric/string workloads — the narrowing pass (i32 for
  provably-integer locals) lands here, flag-gated, fuzzer-proven. v1 measured 3.5×
  on Monte Carlo from this; it is the perf story, but correctness gates it.

## Kept in-tree (the salvage)

Deliberately kept on this branch; everything else from v1 is on `main`:

- **`tests/fixtures/` (~730 files)**: raw material. Triage per phase: each becomes a
  differential fixture (strip `TEST_PASSED` scaffolding — Node is the oracle now), a
  rejection fixture documenting a deliberate non-goal, or gets deleted. Until triaged,
  a fixture's presence does NOT imply the construct is in the subset.
- **`c_bridges/`**: yyjson, os, child-process-spawn (refcount design documented + sound),
  regex, etc. Keep the `cs_` prefix; double-ABI rule (JS numbers cross
  as `double`, never `int`).
- **`scripts/`**: `differential-exec.ts`, `diff-fuzz.ts`, `compiler-baseline.ts` (port
  the runner logic — they reference deleted v1 paths and won't run as-is),
  `build-vendor.sh` + `vendor-pins.sh` (Boehm etc.), `pre-commit`/`pre-push` hooks.
- **`examples/`, `lib/`**: real programs written against v1 — future fixture/stdlib menu.
  Same caveat as fixtures: presence ≠ subset membership.
- **`docs/`**: `salvage-findings.md` (divergence catalog = semantics checklist),
  `tranche3-abort-decision.md` + `compiler-salvage-plan.md` (post-mortem evidence).
- Also reread before Phase 2/3 design: the v1 pitfall memories (Map-object-keys, vtable
  index stability, alloca-escape class) — each becomes either impossible-by-construction
  or a validator rule with a fixture.

## Process rules for implementing agents

(Also in CLAUDE.md — distilled from two years of feedback on the predecessors.)

1. Every commit: differential suite + rejection suite green. Fixture first for any
   behavior change.
2. Suspected miscompile → **<50-LOC synthetic fixture first**, compiled and run, before
   any speculative fix. No fix plans sized before the mechanism is empirically confirmed.
3. No silent defaults ever: `switch` + `never`-exhaustiveness + throw. `ice()` is
   `never`-typed.
4. New feature = new file. Nothing grows past ~800 lines without a split commit first.
5. Estimates in LOC, never time.
6. Land optimization passes dark (flag off), fuzzer-gate, then flip.
7. When a rejection rule feels annoying, the fix is a better diagnostic or a designed
   extension of the contract — never a silent semantic approximation.
8. Keep Node-oracle cross-checks forever; deleting oracles comes last, if ever.

## Unresolved questions

None. Name stays **ChadScript**; this rewrite is v2, living on the `v2` branch.
