# Salvage proposal (2026-09-22)

Status: PROPOSED. Supersedes the "next steps" of `docs/architecture-review-2026-07-22.md` and
`V2_ARCHITECTURE_REVIEW.md` where they conflict. PLAN.md's constitution stays in force.

## TL;DR

v2's pipeline is sound. Its **value model** is not: object layout is derived from the static
type (closed shape, field i at slot i), and TypeScript's structural, unsound types do not
determine runtime layout. That produces silent miscompiles tsc cannot catch and makes the
core TS idioms (interfaces, discriminated unions, generics) unimplementable without patches.
Fix: replace the value model, keep everything else. This is **not** a restart.

## Evidence (reproduced 2026-09-22, `chad run` vs Node; full sources in the appendix)

| program | Node | chad |
| --- | --- | --- |
| `f(p: {x})` called with `{y:2, x:5}` | `5` | `2` (miscompile) |
| `HasB[] = [new A(), {b:"lit"}]`, print `.b` | `x lit` | `lit` (miscompile) |
| `const q: Q = p` (same fields, reordered), write `q.x` | `10 2` | `1 1` (miscompile) |
| discriminated union `switch (s.kind)` | ok | ICE `object literal missing field r` |
| `m.get(k)?.age` on optional field | ok | ICE `unsupported property access .age` |
| generics, `number \| string`, interface method call, closure mutating outer `let` | ok | rejected |

Every one of these is admitted by tsc; three of them are admitted by the validator and
compile to wrong output. Each is a symptom of the same assumption, which is why local fixes
never converged.

## Are we starting from scratch? No.

| area | LOC | fate |
| --- | ---: | --- |
| frontend (tsc gate), validator, HIR nodes + verifier, typed IR builder, driver | ~3.0k | keep |
| C runtime (strings `{ptr,len}`, number formatting, GC, async fibers, fs, timers, path, JSON) | ~2.9k | keep; add shapes + Value |
| test harness, differential oracle, O0/O2 + `opt` verify, fuzzer, 268 run fixtures | n/a | keep, these gate the rewrite |
| `src/lower` + `src/codegen` | ~6.4k | rework roughly half: type-translation, objects, member access, optional, inspect, collections, method dispatch. Control flow, numbers, strings, errors, async, closures mostly stay |

Net: ~4-5k LOC of change, most of it replacing code in place, behind a fixture suite that
already exists.

## Should we go back to the `~/git/hir` approach?

Two different things share the name. v2 already has a HIR (typed IR between lowering and
codegen); that stays. The `~/git/hir` **repo** was NaN-box-first with dynamic semantics
(dictionary objects, prototype chains, `this` binding, defineProperty, npm/lodash coverage,
plus a Node SEA fallback mode). PLAN.md's post-mortem: "v1 failed on architecture, hir failed
on scope." That verdict holds.

What this proposal takes from hir, and what it refuses:

| | hir repo | this proposal |
| --- | --- | --- |
| value rep | everything NaN-boxed | NaN-boxed `Value` **only** at union / generic / unknown positions; `number`, `string`, `boolean` unboxed where tsc says so |
| objects | mutable dictionaries + prototype chain | immutable runtime **shape** per object (no property add/delete, no proto mutation, since the subset forbids them) |
| types | hints, then abandoned ("abandoning static types") | tsc is still the oracle; types choose specialization, never layout correctness |
| scope | open-ended (npm, lodash %) | default-deny subset, `CS####` rejections |
| Node fallback | in-tool mode | whole-program only (see below) |

So: borrow hir's representation idea at the boundaries where TS is polymorphic, keep v2's
static contract everywhere else. Reusable from hir: the NaN-box tag layout
(`c_bridges/v2-nanbox-bridge.c`) as a reference only; its strings are NUL-terminated and its
dynobj is prototype-based, so no code transplant.

## The new value model

Rule: **representation belongs to the value, not to the static type.** Specialize only where
the type is provably exact.

1. **Shaped objects.** Every object record starts with a pointer to an immutable runtime
   `CsShape` (field name → slot, method name → fn). Class instances and literals use the same
   model. Member read/write = per-site inline cache: compare shape ptr, hit → slot load; miss
   → shape lookup, update cache. Direct slot access (no cache) only where the static type is
   exact: classes with `#private` members (TS treats them nominally) or objects that provably
   never escape their allocation site. Optional fields = absent slot in the shape.
   Interface method calls dispatch by name through the shape, so classes and object literals
   with function fields both work.
2. **`Value` (NaN-boxed u64)** wherever the static type is a union of different reps, a type
   parameter, or `unknown`. Narrowing (`typeof`, `===` on a literal discriminant,
   `instanceof`, `in`) compiles to a tag test + unbox. Arithmetic results are NaN-canonicalized
   before boxing. Discriminated unions of objects need no tagging at all: they are all shaped
   objects, and `s.kind` is an ordinary cached field read.
3. **Generics by erasure**: `T` lowers to `Value`, one body per generic function/class.
   Monomorphization is a later optimization pass (flag-off, fuzzer-gated, per PLAN.md).
4. **Mutable closure capture**: captured `let` lives in a heap cell. Standard closure conversion.
5. **Close TS soundness holes in the validator**: reject `any` and non-widening `as`; `x!`
   becomes a runtime check that throws. With value-carried representation, the remaining TS
   unsoundness (array covariance, method bivariance) yields the same behavior as Node instead
   of memory corruption.

## Node handover

Not per construct: mixing a native heap and a V8 heap in one process (libnode embedding,
marshaling object graphs across two GCs) is a larger project than the compiler. Every accepted
program is already valid TypeScript, so the handover is free at program granularity:
`chad build` produces a native binary or lists every out-of-subset span;
`chad run --fallback=node` runs the same source on Node unchanged.

## Phases (each: fixtures first, full gates green, stop and record outcome)

0. **Prove the diagnosis.** Commit the six probes above as failing differential fixtures.
   Add a **structural-subtyping fuzzer**: random interfaces / literals / classes with
   reordered and extra fields, cross-assigned, read and written through each type, diffed
   against Node. It must reproduce the miscompiles on current v2. (~400 LOC)
1. **Shaped objects + inline caches.** Delete positional-shape identity from
   `type-translation.ts`. Exit: the three miscompiles + interface method call pass, fuzzer
   clean, all existing run fixtures green. (~1.5k LOC)
2. **`Value` + unions + narrowing.** Exit: discriminated-union and `number | string`
   fixtures; CS1233 retired. (~1.5k LOC)
3. **Mutable closure capture.** Exit: CS1219 retired. (~200 LOC)
4. **Erased generics.** Exit: generic functions, generic classes, user `Box<T>`,
   `Map<K, V>` with object values through generic helpers. (~600 LOC)
5. **Release profile "TS CLI tools"**: argv, fs, JSON parsed + validated against the
   declared type, async, Map/Set, errors, `chad run --fallback=node`. Generate SUBSET.md,
   ship 0.1.

## Product

A small native binary (hundreds of KB) with millisecond startup, from ordinary TypeScript,
with exact diagnostics for anything outside the subset. `bun build --compile` and Node SEA
bundle a full runtime (tens of MB). Real but niche: CLI tools, cold-start-sensitive
functions, constrained environments. Prior art for the typed-subset-to-native approach:
Static Hermes.

## Open questions

1. `Value` layout: NaN-boxing (8 bytes, matches arrays' i64 slots) vs 16-byte `{tag, payload}`
   (simpler to debug). Recommendation: NaN-boxing, since slots are already 64-bit.
2. Is "TS CLI tools" the release profile, or is there a different target use case?
3. Local test note: the differential suite currently exceeds its 60s bun timeout on this
   machine (131 pass / 4 fail, all from that timeout). Fix the timeout budget in phase 0.

## Appendix: probe sources

Each is a complete program; run with `bin/chad run x.ts` and `node --experimental-strip-types x.ts`.

```ts
interface P { x: number }
function f(p: P): number { return p.x; }
const q = { y: 2, x: 5 };
console.log(f(q));
```

```ts
class A { a = 1; b = "x"; }
interface HasB { b: string }
const arr: HasB[] = [new A(), { b: "lit" }];
for (const h of arr) console.log(h.b);
```

```ts
interface P { x: number; y: number }
interface Q { y: number; x: number }
const p: P = { x: 1, y: 2 };
const q: Q = p;
q.x = 10;
console.log(p.x, q.y);
```

```ts
type Shape = { kind: "c"; r: number } | { kind: "s"; w: number };
function area(s: Shape): number { switch (s.kind) { case "c": return 3 * s.r * s.r; case "s": return s.w * s.w; } }
console.log(area({ kind: "s", w: 2 }));
```

```ts
type R = { name: string; age?: number };
const people: R[] = [{ name: "a" }, { name: "b", age: 3 }];
const m = new Map<string, R>();
for (const p of people) m.set(p.name, p);
console.log(m.get("b")?.age ?? -1, m.get("zz")?.age ?? -1);
```
