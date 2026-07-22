# ChadScript v2 Rules (the `v2` branch)

Read `PLAN.md` first — it is the charter (mission, language contract, architecture,
phases, locked decisions). This file is the standing law for every session.

This branch is the from-scratch rewrite. `main` holds the dead v1 compiler — never land
work there; recover v1 code with `git show main:<path>`. Commit directly to this branch
and push (`origin v2`); no PRs required.

## The constitution (never violate)

1. **tsc is the type oracle.** No custom type inference anywhere. Frontend = TypeScript
   Compiler API at max strictness; zero diagnostics or the program is not ours to compile.
2. **Reject, don't approximate — the validator is default-DENY.** It admits an AST node
   or type ONLY via an explicit allowlist rule that has a passing differential fixture;
   everything else is rejected with `CS####` + span + suggested rewrite. The subset is
   defined by the allowlist in code, not by prose — so an un-considered construct fails
   closed, never reaches codegen. "Compiles but diverges from Node" is a P0 bug.
3. **Sema before codegen, totally.** Every HIR node carries a `TypeId` before the backend
   runs. Backend has zero inference; missing annotation = `ice()` (never-typed throw).
4. **Node is the semantics oracle.** Default test = diff stdout/exit-code of native binary
   vs Node on the same source. No self-reporting TEST_PASSED fixtures.
5. **No silent anything.** Discriminated dispatch = `switch` + `never` exhaustiveness +
   throw default. No fallback IR, no default types, no null-pointer placeholders.
6. **Never self-host.** The compiler runs on Node, forever.

## Workflow

- Every commit: differential suite + rejection suite green. New behavior → new fixture in
  the same commit, fixture written first.
- Suspected miscompile: write a <50-LOC synthetic fixture, compile, run, confirm the
  mechanism — before any fix or fix-plan. No LOC estimates for unconfirmed hypotheses.
- Optimization passes land flag-off, get fuzzer-gated nightly runs, then flip on.
- Estimates in LOC, never time.
- Commits: one line, all lowercase.

## Code style

- Prefer a new file per new feature where it reads well. (No hard line-count cap.)
- TypeScript for the compiler (strict), C for the runtime (`cs_` prefix, kept from v1).
- C runtime ABI: JS numbers cross the boundary as `double`, never `int`/`long`
  (silent ABI mismatch class from v1).
- Comments explain WHY (constraints, invariants, IR patterns), not what.
- Strings in the runtime are UTF-8 `{ptr, len}` — never rely on NUL termination.
  JS-exact semantics guaranteed for ASCII; unicode decision revisits at Phase 4
  (see PLAN.md "Decisions locked").

## IR builder discipline

- All IR goes through the typed builder: values are `{name, type}` records; a
  `BasicBlock` requires exactly one terminator by construction.
- Raw string emission into IR is banned outside the builder module itself.
- Every compile verifies: clang rejects bad IR; CI also runs `opt -passes=verify` per
  fixture at -O0 and -O2, and diffs -O0 vs -O2 program output (difference = UB = P0).

## Testing

- `tests/fixtures/**` auto-discovered. Two kinds:
  - differential: run under Node and as native binary, diff stdout + exit code.
  - rejection: `// @expect-reject: CS1234` — must fail with that code.
- Every validator rule has ≥1 rejection fixture. Every accepted construct has ≥1
  differential fixture.
- Fuzzer: seeded, ASCII-only strings for now, grammar covers only the accepted subset,
  diffs against Node. Smoke run in CI; long runs nightly.
- The ~730 v1 fixtures currently in `tests/fixtures/` are UNTRIAGED raw material —
  presence does not imply the construct is in the subset. Triage per phase (PLAN.md
  "Kept in-tree").

## Salvage map

- `tests/fixtures/`, `examples/`, `lib/` — v1 programs, triage before trusting.
- `c_bridges/` — yyjson/os/child-process/regex bridges (keep the `cs_` prefix).
- `scripts/differential-exec.ts`, `diff-fuzz.ts`, `compiler-baseline.ts` — v1 harness
  logic to port (they reference deleted paths; don't run as-is).
- `scripts/build-vendor.sh`, `vendor-pins.sh` — vendor builds (Boehm etc.), trim to needs.
- `docs/salvage-findings.md` — divergence catalog; treat as a semantics checklist.
- Anything else from v1: `git show main:<path>`.
