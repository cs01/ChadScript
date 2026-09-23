# ChadScript working rules

Read `PLAN.md` first: it is the only charter (mission, constitution, value model, phases).
Work happens on `main`; commit directly and push `origin main`, no PRs. The dead v1 compiler
lives on branch `v1` (tag `v1-final`); recover old code with `git show v1:<path>`.

## Dev loop

```sh
bin/chad run file.ts              # compile + run one program
bun run test                      # fast lane, must stay under 10 s: unit, reject, admission, dod
CHAD_FIXTURE=<substr> bun test tests/slow/differential.test.ts  # one differential fixture
bun run test:slow                 # differential (O0+O2 vs Node), fuzz, runtime: BACKGROUND or CI
bun run test:all                  # everything (what CI runs), plus `bun run test:san`
bun run typecheck && bun run format:check
bun run scripts/bench.ts          # native vs Node timings
bun run scripts/gen-subset.ts     # regenerate docs/SUBSET.md (a test checks drift)
```

Never block on the slow lane. Run it in the background or push and let CI run it; keep
writing code meanwhile. A test that makes the fast lane exceed 10 s moves to `tests/slow/`.

## Rules

- Every commit: fast lane green locally; the slow lane green in CI (or a background run) before
  the next phase closes. New behavior ships with its fixture in the same commit,
  fixture written first. New validator rule ships with a rejection fixture.
- Suspected miscompile: write a <50-LOC fixture, run it against Node, confirm the mechanism
  before proposing a fix. No LOC estimate for an unconfirmed hypothesis.
- Anything the compiler cannot compile correctly is REJECTED at validate with a `CS####`
  code and a rewrite hint. Reaching an `ice()` from a tsc-clean program is a compiler bug.
- Optimizations land flag-off, fuzzer-gated, then flip on.
- Estimates in LOC, never time. Commits: one line, lowercase.
- When a phase closes, update `tests/dod-manifest.ts` and the phase list in `PLAN.md`.
  Do not add new planning docs; edit PLAN.md or delete.

## Code

- Only `src/lower/` imports `typescript`. HIR and codegen never ask the checker anything.
- All IR goes through the typed builder in `src/ir/`; raw IR strings are banned elsewhere.
- Discriminated dispatch: `switch` + `never` + throwing default. No silent fallbacks.
- Runtime is Milo (`runtime/*.milo`, pinned compiler: `sh scripts/setup-milo.sh` once).
  Exported entry points are `@externalLinkage` with the `cs_` C symbol names; every module is
  imported from `runtime/lib.milo`. C only for what Milo cannot express, in `runtime/residue.c`,
  each item commented with why. Runtime memory comes from our collector (`runtime/gc.milo`):
  allocate only through `cs_alloc` / `gcAlloc*` with the layout that names every pointer slot
  (atomic, values, struct bitmap, record, conservative); generated IR through
  `src/codegen/alloc.ts`. Never keep a GC pointer in Milo-owned heap memory (Vec, Heap, string)
  or other malloc memory, which the collector does not scan. Globals need constant
  initializers. Declare libc externs once, in `runtime/libc.milo` (Milo `extern fn` is
  program-wide). Numbers cross the ABI as `double`. Strings are UTF-8 `{ptr, len}`; never rely
  on NUL termination.
- Prefer a new file per feature family. Comments explain WHY, not what.

## Fixtures

- `tests/fixtures/run/`: differential. A directory with `main.ts` is one multi-file program.
- `tests/fixtures/reject/`: `// @expect-reject: CS1234` on the first line.
- Fixtures print their results; Node's output is the expected output. Never self-report.
