# ChadScript V2 Architecture Follow-up Review

Review date: 2026-07-22

Reviewed base: local `v2` at `c7611775`, rebased onto `origin/v2` at `47620004`

## Decision

Continue V2. The July reset is a credible replacement compiler and is substantially healthier than both V1
and the May rewrite.

The earlier review of the cached May `origin/dev` branch is obsolete. The current V2 is a new architecture:

- approximately 6,100 lines across `src/`
- tsc as the parser and type oracle
- a default-deny subset validator
- a checker-free, explicitly typed HIR
- a typed LLVM IR builder with terminator and operand checks
- Node differential execution at `-O0` and `-O2`
- `opt -passes=verify` over every differential fixture
- deterministic seeded fuzzing
- Linux and macOS CI
- self-hosting, npm compatibility, and custom type inference declared permanent non-goals

The existing `docs/architecture-review-2026-07-22.md` correctly identifies the active recovery sequence.
Finish that sequence before expanding the roadmap.

## Current Strengths

### The project has a bounded identity

`PLAN.md` now defines ChadScript as a principled, statically analyzable TypeScript subset. Accepted programs
must behave exactly like Node; unsupported programs must be rejected. This is a much stronger product
boundary than either predecessor had.

### The semantic/backend wall is real

Only `src/lower/` imports TypeScript and asks the checker questions. HIR expressions carry a `ValueType`, and
an architecture test prevents `src/hir/`, `src/ir/`, and `src/codegen/` from importing TypeScript.

### Validation fails closed

The validator explicitly allowlists AST kinds and operator tokens. Recent recovery commits correctly moved
regex, bigint, JSX, JSON, and Date failures from lowering/codegen ICEs to validator diagnostics.

### The backend is mechanically safer

The IR builder uses typed values, checks operand domains, hoists allocas, prevents double terminators, and
rejects unterminated blocks. Discriminated codegen dispatch generally ends in `ice()` rather than producing a
zero or null fallback.

### The test oracle is meaningful

Every accepted fixture is compared against Node at both optimization levels, and the emitted module is
verified with `opt`. This simultaneously checks source semantics, optimization stability, and structural IR.

### The recovery work is responding to evidence

The current branch is fixing concrete differentials and ICEs with focused fixtures. The length-carrying
string ABI and embedded-NUL coverage are particularly important corrections.

## Blocking Findings

These should be resolved before the recovery gate is declared complete or async codegen begins.

### 1. Differential execution does not distinguish crashes, signals, or hangs

`tests/harness/differential.ts` reduces every failed child process to an exit code. A signal, spawn failure, or
other nonnumeric failure becomes exit code `1`. No timeout is configured.

Consequences:

- A compiled binary killed by a signal can be mistaken for an ordinary exit `1`.
- If the Node oracle also exits `1` with the same stdout, the crash may pass differential comparison.
- A compiler-generated infinite loop can hang the test indefinitely.
- Infrastructure failures are reported as semantic exits rather than distinct harness failures.

Required change:

- Record normal exit code, signal, timeout, spawn error, stdout, and stderr separately.
- Require normal termination for both oracle and native runs unless the fixture explicitly describes another
  process outcome.
- Add bounded compile and execution timeouts.
- Treat signals, timeouts, missing binaries, and tool invocation failures as harness failures, never semantic
  results.
- Add harness unit tests using small helper processes that exit, signal, hang, and fail to spawn.

Acceptance:

- A segfaulting binary cannot match a Node program that calls `process.exit(1)`.
- A hanging generated program fails with a useful timeout diagnostic.

### 2. HIR type annotations are claims without an independent verifier

Every HIR expression carries a `ValueType`, which is correct. However, there is no independent pass proving
that node operands and result types agree before codegen.

Today, an inconsistent HIR node is usually caught by a codegen ICE or by LLVM type checks. That is better
than silent emission, but it diagnoses the problem one layer too late and cannot verify source-level facts
that share the same LLVM representation. For example, arrays, objects, optionals, functions, maps, sets, and
caught values all lower to `ptr` at the machine level.

Required change:

- Add a pure `verifyHir(module)` pass between lowering and codegen.
- Verify every expression's operand and result `ValueType` structurally.
- Verify calls, closure signatures, variable assignments, returns, object slots, array elements, map/set
  types, optional wrapping, virtual dispatch slots, and control-flow completion.
- Run it after lowering and after every future HIR transform.
- Add mutation-style tests that construct malformed HIR directly and prove rejection.

Acceptance:

- Codegen never receives malformed HIR.
- Two semantically different pointer-represented values cannot be interchanged merely because both map to
  LLVM `ptr`.

### 3. Default-deny syntax validation is not yet a complete semantic admission contract

The allowlist gates AST kinds and operators, but one admitted syntax kind covers many receiver types,
argument shapes, and contextual combinations. The number of `lower: ... not supported` and `codegen: ... not
supported` ICEs shows that some admitted combinations can still reach later phases.

Recent commits are correctly auditing these cases. Keep doing that systematically rather than waiting for V1
fixtures to discover them.

Required change:

- Inventory every conditional ICE in lowering and codegen that can be reached from an allowlisted AST kind.
- For each, either prove it unreachable from the tsc gate, add a validator rule and rejection fixture, or add
  supported lowering plus a differential fixture.
- Add receiver-type, argument-count, contextual-type, and union-shape validation where syntax-kind gating is
  insufficient.
- Produce a checked report of remaining admission ICEs and ratchet it to zero.

Acceptance:

- Every tsc-clean program admitted by `validate()` either lowers successfully or exposes a compiler bug.
- Unsupported source never intentionally relies on an ICE as its user-facing rejection.

### 4. The two largest compiler files already violate the size constitution

`PLAN.md` says no file should exceed roughly 800 lines. Current sizes are approximately:

- `src/lower/lower.ts`: 1,841 lines
- `src/codegen/expr.ts`: 1,667 lines

These files are still understandable, but their growth rate is the warning. Most new language methods and
expression forms currently extend one or both dispatch centers.

Required change:

- Split lowering by semantic family: declarations/classes, control flow, calls, collections, strings,
  objects, errors, and type translation.
- Split expression codegen along the same HIR ownership boundaries.
- Keep one exhaustive top-level dispatcher while moving implementations into bounded modules.
- Add a source-size check with an explicit temporary allowlist and decreasing thresholds.

Acceptance:

- New string, collection, error, or async work does not add to either current monolith.
- No new compiler source file exceeds the chosen limit without a reviewed exception.

### 5. Runtime object caching is not content- or configuration-addressed

`runtimeObjects()` considers an object current when its modification time is newer than its `.c` source.
The cache key ignores included headers, compiler identity, target, GC flags, and optimization flags.

This can produce locally stale runtime objects after header edits, branch switches, or toolchain changes.
Clean CI is less exposed, but day-to-day debugging can observe code that does not match the checkout.

Required change:

- Hash source contents, transitive project headers, compiler identity, target, and compilation flags into the
  object cache key.
- Alternatively, generate and verify a manifest beside each cached object.
- Add a test proving that a header change invalidates affected runtime objects.

Acceptance:

- The linked runtime is reproducibly derived from the current checkout and toolchain configuration.

## Important Follow-ups

### Align the TypeId documentation with the implementation

The charter says HIR uses interned `TypeId`s, while `src/hir/types.ts` deliberately uses structural
`ValueType` objects until interning becomes useful. The current structural design is reasonable at this
scale. Update the architecture diagram and design principles so there is one authoritative claim.

Do not add interning solely to satisfy old prose. Add it when identity, performance, canonical hashing, or
pass storage requires it.

### Raise deterministic fuzz coverage to the documented gate

`PLAN.md` describes a 300-case CI smoke corpus; `tests/fuzz.test.ts` currently runs 25 fixed seeds. Either
change the documented commitment or raise coverage in a separate bounded CI job. Track grammar coverage, not
only seed count.

### Generate the supported-subset reference

The validator plus `tests/fixtures/run/` are already the executable contract. Generate or mechanically check
a human-readable reference from those sources once the recovery audit stabilizes. Do not hand-maintain a
second feature list.

### Keep async behind its existing design gate

The landed architecture review correctly requires fiber-local exception state, structured completions,
FIFO waiters, a non-lossy microtask queue, rejection resumption, boxing rules, rooting, and portability
decisions. Do not connect the runtime prototype to lowering or codegen until those items have focused runtime
and differential tests.

## Recommended Order

1. Finish the active Phase 5 and validator-admission audit.
2. Harden differential process-result handling and add timeouts.
3. Add `verifyHir()` and malformed-HIR unit tests.
4. Split `lower.ts` and `codegen/expr.ts` before adding another semantic family.
5. Make runtime caching content-addressed.
6. Publish the generated supported subset.
7. Reassess the async gate and choose a small release profile.

## Definition Of Ready For Expansion

V2 is ready for another feature phase when:

- admitted programs cannot intentionally reach lowering or codegen ICEs
- differential tests distinguish normal exits from crashes, signals, hangs, and infrastructure failures
- HIR is independently verified before codegen
- LLVM verification and O0/O2 comparison remain mandatory in CI
- compiler file-size ratchets prevent the dispatch centers from regrowing unchecked
- runtime objects are tied to current source and configuration
- the supported subset is mechanically documented
- the selected release profile remains narrower than the full roadmap

At that point, V2 will not merely be smaller than V1. It will have enforceable boundaries that make continued
growth safer and make failures local enough to debug.
