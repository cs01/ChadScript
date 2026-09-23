# Roadmap

The charter is [`PLAN.md`](https://github.com/cs01/ChadScript/blob/main/PLAN.md); this page summarizes its phases. Each phase lands fixtures first, keeps every gate green,
and records its outcome in the definition-of-done manifest
([`tests/dod-manifest.ts`](https://github.com/cs01/ChadScript/blob/main/tests/dod-manifest.ts)).
Status as of 2026-09-23.

| Phase | What                                                                                                      | Status                                       |
| ----- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0     | Gates: value-model probes as fixtures, structural-subtyping fuzzer                                        | done                                         |
| 1     | Modules: named, default, namespace imports, re-exports, TS-source packages, CommonJS rejections           | done (`node:process` as a module still open) |
| 2     | Runtime ported from C to Milo; C residue under 100 lines                                                  | done                                         |
| 3     | Shaped objects, whole-program field ordering, inline caches                                               | done                                         |
| 4     | `Value` words, mixed unions, narrowing                                                                    | done                                         |
| 5     | Mutable captures in heap cells, erased generics                                                           | done                                         |
| 6     | Own garbage collector in Milo (conservative roots, precise heap, inline bump allocation); libgc dropped   | done                                         |
| 7     | 0.1 "TS CLI tools": argv, fs, validated `JSON.parse`, async, `chad run --fallback=node`, release binaries | planned                                      |

## Planned, not scheduled to a phase

These are rejected today with a specific code, so programs that need them fail at compile time
instead of misbehaving:

- Regular expressions ([CS1213](/reference/errors#cs1213)) and `Date` instances
  ([CS1215](/reference/errors#cs1215)).
- Optional and default parameters ([CS1217](/reference/errors#cs1217)), `let x;` without an
  initializer ([CS1218](/reference/errors#cs1218)), getters, setters and access modifiers.
- `toFixed` and the other number formatting methods ([CS1221](/reference/errors#cs1221)).
- Generics instantiated with arrays, maps or functions ([CS1242](/reference/errors#cs1242)),
  and monomorphization as a flag-gated optimization.
- Optional chains longer than one `?.`, and `Map`/`Set` keyed by a union.
- Garbage collector: evacuation, returning memory to the OS, a generational nursery.
- Unicode: strings are UTF-8 and exact for ASCII; operations that depend on UTF-16 code units are
  gated ([CS1216](/reference/errors#cs1216)) until that decision is made.

## Never

Permanent non-goals: a JavaScript engine in the binary (`eval`, prototype mutation, adding or
deleting properties, `Proxy`), custom type inference or a custom parser, self-hosting, npm
compatibility as a goal (a package works if and only if its TypeScript source is in the subset),
and CommonJS.

## History

Branch `v1` holds v1, a self-hosting compiler that resolved types during code generation and could
not be stabilized. A second attempt went fully dynamic and lost scope. This is the third,
built around two rules: TypeScript's own checker decides every type, and Node decides what every program must print. The post-mortems are in the plan.

Follow progress and file issues on [GitHub](https://github.com/cs01/ChadScript/tree/main).

Next: [Quickstart](/guide/getting-started), and try it on your own code.
