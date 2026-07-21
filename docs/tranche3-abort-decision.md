# Tranche 3 abort decision (compiler salvage plan)

Status: **ABORTED — tranche 3+ (the architectural rewrite). Not the compiler, not tranches 0–2.**
Decided against `docs/compiler-salvage-plan.md` Decision Gate B, with measured evidence.
Audience: any agent/engineer deciding whether to attempt the type-system rearchitecture.

## TL;DR

The **incremental** path through tranche 3 (migrate codegen `typeOf` call sites one at a time
to a pre-computed annotation cache) is **walled**: the type of a `member_access` /
`method_call` — the most common non-leaf expressions — cannot be resolved before codegen,
because resolution depends on the `SymbolTable` that codegen populates *as it runs*. That is
Decision Gate B's explicit STOP condition. The wall is in the code, reproducible in any
session.

The **escape hatch** the plan itself names (Gate B: "finish the semantic model instead of
patching call sites") is real and possible, but it is a multi-week foundational rewrite —
build a complete pre-codegen static type environment. It is out of proportion for a
deprioritized repo whose crash surface is already empty. That is a **judgment call**, and it
is the reviewer's to overrule.

## Evidence (reproducible)

Ran the compiler's built-in divergence trace over all 648 supported fixtures:

```bash
# per-fixture: compile with the trace, aggregate kind × cacheStatus
node dist/chad-node.js build <fixture> -o /tmp/o \
  --diag-trace=type-divergence --diag-trace-out=/tmp/dg.jsonl
```

Aggregate result (`cacheStatus`: `miss` = annotator has no entry, falls back to live
inference; `hit-diff` = annotator entry disagrees with live — unsafe):

| kind            | miss | hit-diff |
| --------------- | ---: | -------: |
| number          | 9270 |        0 |
| string          | 5886 |        0 |
| **member_access** | **4711** | **0** |
| **method_call**   | **1178** | **0** |
| boolean         |  929 |        0 |
| binary          |  314 |        0 |
| call            |  313 |        0 |
| array           |  285 |        0 |
| new             |  192 |        0 |
| variable        |  184 |        0 |
| null            |  102 |        0 |
| index_access    |   90 |        0 |
| type_assertion  |   78 |        0 |
| object          |   66 |        0 |
| (…smaller kinds) |      |        0 |

Two facts decide it:

1. **`member_access` is ~100% miss** (4711 miss, ~0 cached) even though class-typed member
   access has been "admitted" to the annotator since issue #658. It is answered by fallback
   into the 3,108-line `TypeInference`, which grabs the mutable `SymbolTable`
   (`type-inference.ts:110`) and explicitly refuses to cache because "resolution depends on
   symbol-table state that evolves mid-codegen" (`type-inference.ts:105-106`).
2. **The `0 hit-diff` is scar tissue, not safety.** The annotator is deliberately gated to a
   narrow safe subset (`type-annotator.ts:433-443`, class-only). A probe that loosened the
   gate to admit interface member access changed nothing — the expressions stayed uncached
   because `resolveExpressionTypeRich` returns null pre-codegen (receiver type unknown before
   the SymbolTable is populated). Prior attempts to actually close this (issue #658
   gate-loosen: #662) **segfaulted x86-64 Stage 0→1 self-hosting and were reverted (#666)**;
   #663–#665 broke the same arch. See the comments at `type-annotator.ts:427-476`.

## Why not just "finish the semantic model" now

Gate B's remedy is to build the complete static type environment *before* migrating. That
means resolving `member_access` / `method_call` / `index_access` receiver types in a
pre-codegen pass with no dependency on the mutable `SymbolTable` — for the general case
including narrowing and interface→concrete-class dispatch. Reasons this was judged not worth
starting now (all overridable by the reviewer):

- It is the exact work prior attempts could not stabilize (#662–#666).
- The dual-host baseline shows **0 crashes / 0 anomalies across 691 fixtures × 2 hosts** — the
  segfault bug-class this rearchitecture targets is currently dormant.
- The repo is marked deprioritized; the session's guiding constraint was 80/20 ("keep the
  supported subset small; a non-self-hosting compiler that still works").

## What tranche 3 WOULD look like if a reviewer greenlights it

Feasibility notes from the assessment (still valid, just gated behind the model work):

- **PR 3.1 (canonical `TypeId` interner):** feasible as a bounded refactor. `TypeContext`
  (`type-context.ts`) already interns primitives but keys on only `base + depth + nullable` —
  it ignores `typeParams`/`numericKind`/`sourceKind`. ~39 ad-hoc `createResolvedType` /
  `parseTypeString` sites (≈20 in `type-resolver.ts`) construct un-interned types. Routing
  them through `TypeContext` + widening the key is countable and differential-testable.
- **`cachedLlvmType` removal:** small — 3 read sites; `resolvedTypeToLlvm`
  (`type-system.ts:283`) already has a full fallback. BUT a `LayoutTable` (PR 3.2) must first
  absorb the element-representation distinction (`%Array*` vs `%ObjectArray*` vs
  `%StringArray*`) that `cachedLlvmType` currently smuggles.
- **PR 3.3 (total annotation) is the linchpin and the wall.** Do NOT attempt it as a
  one-shot migration of the 31+ codegen `typeOf` consumers — that is the big-bang the plan
  forbids. It requires the static semantic model above first. **Also missing: PR 2.3
  (`sema-dump`) does not exist** — build it and re-run `--diag-trace=type-divergence` per
  expression kind to re-measure the gap before committing.

Recommended charter for a fresh attempt (own session, long runway):
> Build a pre-codegen static type environment that resolves `member_access` / `method_call`
> receiver types without the mutable `SymbolTable`. Prove it by driving `member_access` miss
> count toward zero with `hit-diff` staying 0. Only then start PR 3.1.

## What was delivered (tranches 0–2 — kept, green)

13 commits this session, all with `npm test` + differential harness + fuzzer green:

- Negative-fixture crash contract (crashes/timeouts/wrong-diagnostics now fail, not pass)
- Dual-host baseline (`npm run baseline`) + support-matrix (`npm run support-matrix`)
- Node-oracle differential harness (`npm run diff-exec`) + seeded fuzzer (`npm run diff-fuzz`)
- **3 miscompiles fixed:** `Math.ceil`/`round` on params (integer-narrowing), `toString(radix)`
  ignored the base, `Infinity`/`NaN` printed as C's `inf`/`nan`
- Findings log: `docs/salvage-findings.md` (includes the one remaining open silent divergence:
  bitwise ops are 64-bit, not JS's 32-bit)

## Reproduce this decision

```bash
npm run build
# aggregate the annotation gap yourself:
for f in $(grep -rL -e '@test-compile-error' -e '@test-skip' --include='*.ts' tests/fixtures); do
  node dist/chad-node.js build "$f" -o /tmp/o --diag-trace=type-divergence --diag-trace-out=/tmp/dg.jsonl 2>/dev/null
  cat /tmp/dg.jsonl 2>/dev/null
done | node -e 'let a={};require("readline").createInterface({input:process.stdin}).on("line",l=>{try{let e=JSON.parse(l);a[e.kind]??={miss:0,"hit-diff":0};a[e.kind][e.cacheStatus]++}catch{}}).on("close",()=>console.log(a))'
```

Expect: `member_access` and `method_call` dominated by `miss`, `hit-diff` ≈ 0 everywhere.
That distribution IS the Gate B verdict.
