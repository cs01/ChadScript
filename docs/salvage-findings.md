# Salvage findings

Divergences and bugs surfaced by the salvage tooling (dual-host baseline, differential
execution harness, seeded fuzzer) and by targeted probes. Each is a reproducible,
minimized case. "Node" = `tsx` running the `.ts` directly (JS oracle); "chad" = the
node-host ChadScript compiler's binary.

Status legend: **fixed** · **open** · **intentional** (documented ChadScript≠JS choice).

## Fixed

- **`Math.ceil`/`round` on a function parameter returned the truncated value.**
  `function f(x:number){return Math.ceil(x)} f(3.2)` gave `3`, not `4`. Cause: the
  integer-narrowing pass narrowed a `number` parameter to `i64` (truncating the fractional
  part) whenever the parameter was only used inside a `Math.*` float builtin. Fixed by
  disqualifying any variable consumed by a `Math.*` builtin from integer narrowing
  (`src/codegen/infrastructure/integer-analysis.ts`). Guarded by the differential harness.

## Fixed (cont.)

- **`Number.toString(radix)` ignored the radix.** `(255).toString(16)` gave `"255"`, not
  `"ff"`. Fixed: `handleNumberToString` now forwards the radix to a new runtime helper
  `cs_num_to_str_radix` (bases 2..36, lowercase digits, `-` for negatives; base 10 and
  non-integers defer to the decimal formatter).
- **Non-finite numbers printed C-style.** `1/0` gave `"inf"`, `0/0` gave `"nan"`. Fixed:
  `cs_num_to_str` now emits the JS spellings `"Infinity"`/`"-Infinity"`/`"NaN"`.

## Open — silent divergences (wrong output, no error)

- **Bitwise shift is 64-bit, not JS's 32-bit.** `1 << 40` → chad `1099511627776`, Node `256`
  (JS masks the shift count to 5 bits and truncates operands to int32). Divergence for shift
  counts ≥ 32 and for results outside int32. Broad change (affects all bitwise ops incl.
  `>>> 0`); deferred pending a decision on adopting JS int32 bitwise semantics wholesale.

## Open — likely-intentional but worth a decision

Surfaced by the differential harness; currently tracked in
`tests/baseline/differential-divergences.json`.

- **Error objects stringify to the bare message** (`"from inner"`), not `"Error: from inner"`.
- **A boolean concatenated into a string prints `1`/`0`**, not `true`/`false`.
- **Out-of-bounds array/string access returns clamped/empty**, not `undefined`.
- **`console.log` of arrays/maps/objects/classes** formats unlike Node `util.inspect`.
- **`obj.field(...)` where `field` is a data field** resolves to a free function of that name
  (`{add:0}; obj.add(5,7)` → calls a top-level `add`), rather than throwing. Arguably a real
  bug; niche.

## Native-host observations (self-hosting is deprioritized; recorded, not scheduled)

- **`duplicate module-level declaration` diagnostic prints uninitialized bytes.** The native
  compiler's message includes garbage memory ("first declared as <NONPRINT>"), varying
  run-to-run. Surfaced by the baseline's non-printable detection.
- **Native has no LLVM module verifier.** The in-memory C-API path (`c_bridges/llvm-bridge.c`)
  never runs `LLVMVerifyModule`; the node host gets verification free via `clang -c file.ll`.
  All 645 currently-compiled native modules pass `opt -passes=verify`, so no active bug —
  but the guard is absent.

## How to reproduce

```bash
npm run baseline          # dual-host snapshot → tests/baseline/compiler-baseline.json
npm run diff-exec         # fixtures: Node oracle vs compiled binary (allowlist-gated)
npm run diff-fuzz -- --count 300 --seed 7   # seeded integer-program fuzzer
```
