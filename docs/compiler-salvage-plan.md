# ChadScript Compiler Salvage Plan

Status: proposed execution plan

Audience: the agent or engineer responsible for making ChadScript dependable again

## Decision

ChadScript is worth one bounded salvage attempt. Do not resume ordinary feature work during the attempt.
The existing runtime, fixtures, parsers, and supported behavior have real value, but the compiler core must
stop deriving types and layouts independently at code-generation sites.

This is not permission for an open-ended rewrite. The plan has three decision gates. If a gate fails, stop
and preserve ChadScript as an experimental compiler rather than continuing to patch undefined behavior.

## Mission

Make this pipeline true:

```text
source -> parser -> canonical AST -> semantic model -> lowered operations -> LLVM -> executable
```

At every arrow, the producer owns a documented contract and the consumer validates it. Code generation
must eventually become a consumer of semantic facts, not another semantic-analysis implementation.

## Non-goals

- Do not add language features, standard-library modules, or optimizations.
- Do not broaden TypeScript compatibility.
- Do not rewrite the parser, runtime, and backend simultaneously.
- Do not preserve self-hosting at the expense of correctness during the migration.
- Do not introduce another type representation alongside `ResolvedType`, `TypeContext`, and `SemaTable`.
- Do not perform repository-wide mechanical migrations without a behavioral test for each migrated family.
- Do not declare success because Stage 2 compiles hello-world.

## Operating Rules

1. One PR changes one invariant or migrates one bounded expression family.
2. Begin every bug fix with a minimal reproducer. Keep it after the fix.
3. A compiler crash is always a test failure, including for invalid source programs.
4. Every fallback for an unknown type, AST kind, layout, or LLVM representation must return a diagnostic or
   throw. It must never silently choose `i8*`, `double`, `object`, or null.
5. New semantic code may inspect source types and the AST. LLVM lowering may inspect only semantic results.
6. Keep old and new paths available only while a differential assertion compares them. Delete the old path
   when a family is migrated.
7. Record baseline failures; never weaken an assertion to turn a red test green.
8. Run the repository-required verification after every PR-sized todo. Do not stack work on a failing base.
9. Follow the repository worktree and source-control rules. Do not push unless the user explicitly authorizes
   it under the applicable local rules.

## Required Metrics

Add `scripts/compiler-health.ts` in the first tranche. It should print stable, machine-readable counts and
fail when a ratchet moves backward. Track at least:

- compile-error fixtures that terminate by signal
- compile-error fixtures missing their expected diagnostic
- expressions for which `ctx.typeOf(expr)` has no semantic type
- codegen calls to `TypeInference` outside the semantic annotation phase
- source-type string parsing below the semantic layer
- silent fallback returns in discriminated dispatch
- raw `ctx.emit()` sites
- fixture results that differ between the Node-hosted and native-hosted compilers
- AST parity mismatches

Initially, only crash and missing-diagnostic counts must be zero. Snapshot the other counts and ratchet them
downward. Never use a metric based only on source line count.

## Tranche 0: Freeze and Reproduce

### PR 0.1 - Publish the support contract

Create `docs/language/supported-subset.md` from the behavior already covered by passing fixtures. Classify
each syntax and type combination as `supported`, `rejected with diagnostic`, or `unknown`.

Also create a machine-readable version, for example `tests/support-matrix.json`, used to tag fixtures.
Do not claim generic TypeScript compatibility.

Acceptance:

- Every existing fixture belongs to a support-matrix category.
- `unknown` combinations are not promoted to supported merely because one example happens to pass.
- README language links to the support contract.

### PR 0.2 - Capture a trustworthy baseline

Add a command that runs the fixture suite with the Node-hosted compiler and native-hosted compiler in clean,
separate build directories and writes a JSON result containing compile status, signal, exit code, stdout,
stderr, and executable output.

Commit the summarized baseline, not binaries or transient build output.

Acceptance:

- The command is deterministic across two consecutive runs.
- A stale `.build/chad` cannot be selected accidentally.
- Infrastructure failures are distinguishable from compiler failures.

## Tranche 1: Make Failure Trustworthy

### PR 1.1 - Stop accepting crashes as diagnostics

Change `tests/compiler.test.ts` so a compile-error fixture passes only when all are true:

- the compiler exits normally with a documented nonzero exit code
- it is not terminated by a signal
- stderr contains the exact expected diagnostic category and stable message fragment
- no executable is produced

Add regression fixtures for the historical `emitError` crash paths. Fix only enough compiler plumbing to
make those failures diagnostic; do not redesign semantic analysis in this PR.

Acceptance:

- No negative fixture can pass because of a segfault, abort, timeout, or arbitrary nonzero exit.
- Both compiler hosts meet the same diagnostic contract.

### PR 1.2 - Verify every emitted LLVM module

Introduce one LLVM verification boundary used by tests and normal debug builds. Prefer the LLVM verifier
already available through the builder integration; otherwise invoke a pinned `opt -passes=verify` or
`llvm-as` before native compilation.

Preserve the failing `.ll` file when verification fails and print the source fixture and failing pass.

Acceptance:

- Every fixture's IR is verified before linking.
- A deliberately malformed test module proves the verifier is actually active.
- Verification cannot be skipped silently because an LLVM tool is missing.

### PR 1.3 - Add sanitizer lanes

Use the existing address-sanitizer compiler option to run a representative deterministic corpus. Add UBSan
where the host toolchain supports it. Include arrays, object/interface layouts, closures, async operations,
maps/sets, JSON, and class inheritance.

Acceptance:

- Sanitizer failures retain the minimized source and command line.
- The lane has no known sanitizer findings before it becomes required.
- Platform-specific exclusions are explicit and justified in data, not comments in CI shell code.

### Decision Gate A

Proceed only when:

- negative tests cannot pass through crashes
- emitted LLVM is always verified
- the baseline is reproducible
- the supported subset is written down

If these cannot be achieved without widespread semantic changes, stop. The current implementation is not a
safe base for incremental repair.

## Tranche 2: Establish a Semantic Oracle

### PR 2.1 - Make parser parity complete

Replace the current structural AST summary with a canonical serialization of the entire AST used by
codegen: statements, expressions, declared types, modifiers, optional flags, imports, interfaces, classes,
and source-independent literal values. Exclude only locations and parser-specific trivia.

Run the same serializer against the TypeScript parser and native parser.

Acceptance:

- Each non-error fixture has full-tree parity.
- Mutating a nested binary operator, field type, optional-call flag, or switch case makes the test fail.
- The serializer is versioned so AST schema changes require an intentional golden update.

### PR 2.2 - Add differential execution

For the supported pure-language subset, execute the original program with Node and the compiled binary with
ChadScript. Compare structured output and exit status. Provide a tiny test API that emits canonical JSON so
floating-point edge cases, arrays, nulls, and objects are compared deliberately.

Do not differential-test ChadScript-specific FFI or native APIs against Node. Give those contract tests.

Acceptance:

- Arithmetic, branching, loops, functions, classes, arrays, strings, and supported object operations have
  differential coverage.
- A seeded generator combines supported constructs into small programs.
- Every generated failure is minimized and saved as a fixture before repair.

### PR 2.3 - Add semantic snapshots

Extend AST dump or add `sema-dump` to serialize, for every expression:

- stable expression ID
- semantic type ID
- source-level type
- representation/layout ID
- lvalue/rvalue status where relevant
- resolved symbol, member, function, or method target
- required coercion

The dump is a diagnostic artifact, not an LLVM API. Add focused goldens for high-risk compositions rather
than a golden for every fixture.

Acceptance:

- Two codegen sites cannot assign different semantic types to the same expression.
- The dump happens before any LLVM emission.
- Running codegen does not mutate the dump.

## Tranche 3: Create One Type and Layout Authority

Build on the existing `ResolvedType`, `TypeContext`, type annotator, and `SemaTable`. Consolidate them; do not
add `NewType`, `HIRType`, or another parallel cache.

### PR 3.1 - Define canonical type identity

Make `TypeContext` the only creator and interner of semantic types. A `TypeId` must identify the complete
semantic type, including:

- primitive, class, interface, function, collection, union, null, unknown, and void kind
- type arguments and array depth
- nullability and optionality
- numeric specialization when semantically relevant

Remove `cachedLlvmType` from semantic identity. LLVM representation is a target/layout decision, not a
source-language type property.

Acceptance:

- Structurally equal types intern to the same ID.
- Different class/interface identities never collide because their textual spelling is similar.
- Generic and nested-array parsing is tested independently of codegen.
- Unknown or unsupported types carry a reason and source location; they are not represented as `i8*`.

### PR 3.2 - Define canonical layouts

Add a `LayoutTable` keyed by `TypeId` and target. It owns:

- LLVM value type
- size and alignment
- boxed versus unboxed representation
- field order and field offsets
- array element representation and stride
- class/interface ABI and vtable shape
- GC pointer map or allocation class

All layouts are immutable after semantic analysis. Class and interface field iteration must use the same
canonical inherited-field list.

Acceptance:

- Codegen cannot independently choose array storage, boolean representation, or object field layout.
- Layout validation rejects duplicate fields, incomplete inheritance, illegal recursive inline layouts, and
  ABI-incompatible unions.
- Layout unit tests cover every supported type constructor without emitting a full program.

### PR 3.3 - Complete expression annotation

Make the type annotator total for the documented supported subset. `ctx.typeOf(expr)` becomes a pure lookup
that returns `TypeId`; it must not call `TypeInference` or inspect mutable codegen symbols.

For unsupported expressions, semantic analysis emits a diagnostic before codegen. Add a post-sema verifier
that visits the entire AST and proves every expression and binding required by codegen is annotated.

Acceptance:

- Semantic coverage is 100% for supported fixtures.
- Codegen cannot start if coverage is incomplete.
- Annotation is independent of AST traversal order during LLVM generation.
- The semantic model is unchanged before and after codegen.

### PR 3.4 - Centralize conversions

Create a conversion table over `(source TypeId, destination TypeId, context)` that yields an explicit
conversion operation or a diagnostic. Include boxing, unboxing, numeric casts, nullable checks, interface
upcasts, collection element conversions, and promise resolution.

Acceptance:

- Assignment, call arguments, returns, field initialization, array insertion, closure capture, and async
  resolution all use the same conversion authority.
- No codegen site infers a conversion from LLVM type strings.

### Decision Gate B

Proceed only when all supported fixtures receive complete immutable semantic annotations and layouts before
codegen. If `ctx.typeOf()` still needs fallback inference for common programs, stop migration and finish the
semantic model instead of patching call sites.

## Tranche 4: Introduce Lowered Operations Incrementally

Do not begin with a whole-program MIR rewrite. Introduce a small typed operation model and migrate vertical
families. Each operation carries `TypeId`, layout ID where applicable, operands, result, and source location.
Control-flow operations name blocks and successors explicitly.

Initial operation groups:

```text
constants and locals
load/store/field/index
convert
unary/binary/compare
call/method-call/runtime-call
allocate
branch/conditional-branch/phi/return
```

The operation verifier checks operand types, result types, block termination, phi predecessors, allocation
lifetime, and call signatures before LLVM lowering.

### PR 4.1 - Scalars and local variables

Migrate literals, local bindings, primitive loads/stores, scalar arithmetic, comparisons, and returns.
Compare old and new execution results for every affected fixture during the PR. Delete the old scalar path
when parity is achieved.

### PR 4.2 - Control flow

Migrate conditionals, loops, switch, short-circuiting, and phi construction. Require the operation verifier
to reject unterminated blocks, double terminators, invalid fallthrough, and mismatched phi inputs.

### PR 4.3 - Functions and calls

Migrate standalone functions, parameters, default arguments, return conversions, and direct calls. Function
signatures come only from the semantic model and layout table.

### PR 4.4 - Classes and interfaces

Migrate allocation, inherited fields, constructors, member access, methods, interface upcasts, and dispatch.
Use one metadata record for field indexing and method resolution.

### PR 4.5 - Collections

Migrate arrays first, then maps and sets. Treat each distinct storage strategy as a layout, not a flag hidden
in codegen state. All insertion and extraction operations must name the element `TypeId` and conversion.

### PR 4.6 - Closures and async

Migrate capture environments, escape decisions, function values, promises, async return values, and await.
Allocation lifetime and boxing must be explicit operations validated before LLVM lowering.

### PR 4.7 - Standard library and FFI

Describe runtime functions in a machine-readable ABI table and generate declarations and checked call
operands from it. The same table controls required bridge linking and feature flags.

For each family above, acceptance requires:

- unit tests for the semantic and operation verifier behavior
- differential execution tests for supported language semantics
- focused composition tests with previously migrated families
- zero increase in fallback and legacy-path health metrics
- deletion of the replaced inference and emission path

## Tranche 5: Remove the Parallel Compiler Inside Codegen

After all supported families migrate:

1. Delete codegen access to `TypeInference`.
2. Delete source-type parsing from `src/codegen/`.
3. Delete legacy symbol/layout side tables superseded by the semantic model.
4. Delete raw type-to-LLVM dispatch outside `LayoutTable`.
5. Make unknown operation and type variants fatal verifier errors.
6. Turn the health ratchets into zero-tolerance checks for all supported paths.

Acceptance:

- Codegen takes only lowered operations, layouts, runtime ABI data, and target options.
- No codegen method accepts a source AST expression.
- Adding a semantic type requires an exhaustive compiler error in every relevant semantic/layout dispatch.
- Adding an LLVM lowering operation requires an exhaustive compiler error in the backend dispatch.

### Decision Gate C

Compare the new pipeline with the baseline:

- supported fixtures and differential programs agree
- diagnostic fixtures exit cleanly with correct messages
- sanitizer and LLVM verifier lanes are clean
- failures are reproducible from retained artifacts
- type/layout fallbacks are zero
- a new composition does not require editing unrelated type-dispatch sites

If these are true, resume limited feature work. If not, freeze the supported subset and ship only maintenance
fixes until the failed criterion is addressed.

## Tranche 6: Reintroduce Self-hosting Deliberately

Self-hosting is last, not a permanent constraint on the repair implementation.

1. Compile the compiler with the Node-hosted reference implementation.
2. Run the complete fixture, diagnostic, semantic snapshot, and differential suites with Stage 1.
3. Build Stage 2 and repeat the same suites, not only hello-world.
4. Compare canonical AST and semantic dumps between stages.
5. Compare deterministic LLVM output where nondeterministic identifiers have been normalized.

Stage 2 is accepted only if it behaves as the same compiler, not merely if it can produce an executable.

## First Ten PRs

Execute these in order. Do not start the type migration before the first six are green.

1. `[tests] reject compiler crashes in negative fixtures`
2. `[tests] record deterministic dual-host compiler baseline`
3. `[docs] publish supported language subset matrix`
4. `[llvm] verify every emitted module before linking`
5. `[tests] add representative address sanitizer corpus`
6. `[parser] compare complete canonical ASTs across frontends`
7. `[tests] add differential execution harness for pure programs`
8. `[sema] dump stable expression types and resolved targets`
9. `[type-system] make TypeContext the canonical type interner`
10. `[type-system] centralize target layouts by semantic type id`

After PR 10, reassess Gate B before scheduling further work.

## Review Checklist For Every Salvage PR

- What single invariant becomes stronger?
- What minimal fixture failed before this change?
- Which old path is deleted or ratcheted downward?
- Can invalid input crash instead of producing a diagnostic?
- Can traversal order change the result?
- Is a source type being reconstructed from a string?
- Is an LLVM type being used as a proxy for semantic type?
- Is layout chosen anywhere except `LayoutTable`?
- Does the change work under both parser hosts where applicable?
- Are sanitizer, verifier, unit, fixture, and self-hosting results recorded as appropriate?

## Abort Conditions

Stop the salvage attempt and archive the compiler if any of these persist after their owning tranche:

- Negative programs still pass tests through compiler crashes.
- Full parser parity cannot be obtained for the claimed supported subset.
- Common expressions cannot receive stable types before codegen.
- Layout depends on mutable codegen traversal state.
- The old and new paths cannot be compared on deterministic programs.
- Migrating one operation family repeatedly requires unrelated backend changes.
- Self-hosting constraints prevent implementing or testing the semantic contracts.

Stopping under these conditions is not failure. It prevents more effort from being invested in a compiler
whose correctness cannot be made local and testable.

## Definition Of Unstuck

ChadScript is unstuck when an engineer can add one supported operation by changing its semantic rule, its
lowered operation, and its LLVM lowering, while exhaustive dispatch and differential tests identify every
missing case. It is not unstuck merely because the current fixture suite is green.
