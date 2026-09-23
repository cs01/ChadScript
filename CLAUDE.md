# ChadScript working rules

Read `PLAN.md` first: it is the only charter (mission, constitution, value model, phases).
Work happens on the `v2` branch; commit directly and push `origin v2`. Never land on `main`
(dead v1; recover code with `git show main:<path>`).

## Dev loop

```sh
bin/chad run file.ts              # compile + run one program
bun test tests/                   # every gate: rejection, differential (O0+O2 vs Node), unit
CHAD_FIXTURE=<substr> bun test tests/differential.test.ts  # one fixture
bun run test:san                  # same suite under ASan + UBSan
bun run typecheck && bun run format:check
bun run scripts/bench.ts          # native vs Node timings
bun run scripts/gen-subset.ts     # regenerate docs/SUBSET.md (a test checks drift)
```

## Rules

- Every commit: all gates green. New behavior ships with its fixture in the same commit,
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
- Runtime is C with the `cs_` prefix until phase 2 moves it to Milo; new runtime code after
  that is Milo, keeping the `cs_` symbol names. Numbers cross the ABI as `double`. Strings are UTF-8
  `{ptr, len}`; never rely on NUL termination.
- Prefer a new file per feature family. Comments explain WHY, not what.

## Fixtures

- `tests/fixtures/run/`: differential. A directory with `main.ts` is one multi-file program.
- `tests/fixtures/reject/`: `// @expect-reject: CS1234` on the first line.
- Fixtures print their results; Node's output is the expected output. Never self-report.
