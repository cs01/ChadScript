# Architecture and scope review (2026-07-22)

Status: active implementation guidance. Read this before extending Phase 5, async, strings, or
the standard library. `PLAN.md` remains the charter; this document records the review gate and
the concrete work needed to satisfy it.

## Overall decision

The v2 direction is sound: tsc is the type oracle, validation is default-deny, HIR is fully typed
before codegen, and Node differential tests define correctness. This is an appropriate foundation
for a small educational compiler that supports useful programs without attempting all JavaScript
or npm compatibility.

Do not broaden the language merely because an old v1 fixture or document mentions a feature.
The supported subset is the validator allowlist plus passing v2 differential fixtures. Roadmap
items in `PLAN.md` are not current support claims.

## Recovery sequence and stopping rule

Recent work expanded breadth faster than phase invariants were closed. Do not continue that mode.
Until this recovery sequence is complete, new methods and unrelated language constructs are out
of scope:

1. Freeze async after its runtime prototype; do not wire it into lowering or codegen.
2. Finish Phase 5 as a coherent semantic slice, including structured completions, catch values,
   nested propagation, and differential rejection/acceptance coverage.
3. Repair the locked string ABI and add embedded-NUL fixtures. Make the Unicode decision explicit.
4. Audit every currently admitted AST/type combination for a validator diagnostic rather than a
   lowering/codegen ICE. Add missing rejection fixtures.
5. Publish a current supported-subset reference from passing `run/` fixtures and the allowlist.
6. Choose one small release profile from "Recommended definition of done". Only then resume
   async, followed by JSON and the minimal CLI APIs needed by that profile.

A phase is not a request to implement every bullet indefinitely. Before moving on, record one of
three outcomes for each bullet: complete with fixtures, deliberately deferred and still rejected,
or removed from the target release. A phase exits when its chosen invariants are green, not when
all imaginable surface area has been added. Do not keep adding sibling methods while a foundational
invariant in the same or an earlier phase is incomplete.

Agents should work one bounded semantic slice at a time. Each slice has an acceptance fixture, a
rejection boundary, implementation, and the full gates. After that slice, stop and update the phase
status instead of selecting another feature merely because context or token budget remains.

During the validator audit, the default repair for an admitted construct that reaches an ICE is a
validator rejection with a focused rejection fixture. Implementing the construct is appropriate
only when it is already part of the chosen release profile and its Node semantics can be made exact.
Do not use untriaged v1 fixtures as a feature queue or count newly passing v1 fixtures as evidence
that the recovery audit is converging.

## Gate before further async work

The stackful-fiber approach can remain: it keeps lowering readable and is a reasonable tradeoff
for this project. Before async codegen is connected, all of these must be designed and tested:

1. Exception handler chains and the current thrown value belong to a fiber, not global process
   state. A global handler stack can longjmp from one fiber into another suspended fiber.
2. The fiber trampoline catches every escaping throw and rejects the async function's result
   promise. An async function must not synchronously throw to its caller, including before its
   first `await`.
3. Phase 5 structured exits are complete: catch binding, thrown values, and return/break/continue
   through `finally`. Async must not be built on the current partial completion model.
4. Promise waiters run FIFO. The current prepend-and-traverse waiter list is LIFO.
5. The microtask queue grows or fails loudly. The fixed 4096-entry ring currently aliases full
   with empty and can silently discard work.
6. A suspended await records whether it resumes fulfilled or rejected. Rejection resumes by
   throwing inside the awaiting fiber.
7. `await` outside an async fiber, top-level await, thenables, promise assimilation, and unhandled
   rejection behavior are each explicitly supported or validator-rejected.
8. The boxing representation is specified for `Promise<T>` for every admitted `T`, including
   `void`/`undefined`, nullable values, pointers, numbers, and booleans.
9. Fiber stack rooting, stack exhaustion, supported host targets, and the deliberate `ucontext`
   portability limitation are documented.

Required differential fixtures include settled-await ordering (`1, 3, 2`), pending resolution,
multiple waiters in registration order, nested calls, throws before and after await, independent
try handlers in concurrent fibers, and more than 4096 queued continuations. Run every case at O0
and O2. Runtime-only machinery also needs focused C-level tests before it is treated as a
foundation.

## Phase 5 dependency

`PLAN.md` originally called for Itanium unwinding, while the implementation uses
setjmp/longjmp. Simplicity favors setjmp/longjmp for this compiler, but the charter and code must
agree. Keep it only after specifying a structured completion model that correctly handles:

- normal fallthrough, return, break, and continue through `finally`;
- a throw from try, catch, or finally;
- a return from finally overriding an earlier completion;
- nested handlers across ordinary calls and fiber suspension;
- catch values without a single global pending-message slot.

This should be finished before async rather than patched independently into the async runtime.

## Documentation authority

Documentation currently describes three different products. Use this hierarchy:

1. `PLAN.md`: mission, locked architecture, and roadmap.
2. Validator allowlist plus passing fixtures under `tests/fixtures/run/`: executable current
   support contract.
3. A maintained supported-subset reference generated or checked against those two sources.
4. Salvage documents and all other v1 fixtures: historical evidence only.

`lib/skill.md` is a v1 artifact. It incorrectly advertises watch/init/cross-compilation, HTTP,
fetch, Node modules, type-erased generics, enums, and capture-by-value closures. It must not guide
v2 work until rewritten. `tests/fixtures/README.md` likewise describes the raw v1 corpus and an
obsolete harness. The presence of a fixture outside `run/` or `reject/` is not a support claim.

The accepted/rejected lists in `PLAN.md` are partly roadmap language. Label them as target scope,
or split current support from planned support. In particular, static ESM modules, interfaces as
fat pointers, generics, JSON, process, fs, regex, and async are not current support merely because
they appear in the accepted roadmap.

## Standard library scope

Keep the standard library deliberately narrow and organize it into explicit tiers:

### Tier 1: language/runtime essentials

- `console.log` for every admitted value representation
- selected `Math` operations and constants
- `String`/`Number`/`Boolean`, `parseInt`, and `parseFloat`
- arrays, strings, `Map`, `Set`, and closed-object inspection
- error values and promises once their phases are complete

Each method is separately allowlisted. TypeScript's declaration files exposing a method is not
enough to admit it.

### Tier 2: useful deterministic data APIs

- typed `JSON.parse<T>` with runtime shape validation and `JSON.stringify`
- a small, explicitly enumerated regex subset only if it remains understandable

JSON is higher value for real educational CLI programs than broad Array/Promise method parity.

### Tier 3: CLI host APIs

- `process.argv`, selected `process.env`, and `process.exit`
- synchronous text `node:fs` read/write first
- a small `node:path` subset if multi-platform fixtures define its behavior
- `node:fs/promises` only after the async scheduler is correct

Prefer standard Node spellings so the same source remains executable by the oracle. Do not add
networking, child processes, HTTP servers, embedding, crypto, databases, or general npm loading
to the core scope without a separate design review.

## String representation blocker

The charter locks runtime strings to UTF-8 `{ptr, len}`, but the current runtime represents them
as NUL-terminated `char *` and uses `strlen`, `strcmp`, and `strstr` throughout. This is already a
semantic divergence for embedded NUL, which is ASCII and therefore covered by the current exact
semantics promise. Unicode indexing is a second known divergence because JS indexes UTF-16 code
units while the runtime indexes UTF-8 bytes.

Before adding JSON, fs, or more string methods, migrate to one canonical length-carrying string
ABI. All string literals, concatenation, comparison, map/set string keys, inspection, parsing,
and I/O must consume it. C interop may create a temporary NUL-terminated buffer at a boundary;
NUL termination must not define the language value.

Add differential fixtures for embedded NUL immediately. Then make a deliberate Phase 4 decision:
implement UTF-16-code-unit semantics over UTF-8 storage, or validator-gate operations that cannot
be exact for non-ASCII strings. Never document general JS string compatibility while indexing
bytes.

`charCodeAt` and relational string comparison were admitted during the recovery audit using UTF-8
byte behavior. Their ASCII fixtures are insufficient: both operations accept arbitrary runtime
strings, while Node uses UTF-16 code units. Either implement the exact semantics and add non-ASCII
differential fixtures or reject these operations until that work is chosen. This is a correctness
gate, not optional breadth.

## Runtime and stdlib discipline

- Put shared runtime structs and function declarations in headers. Avoid locally repeated
  `extern` declarations whose C types can drift across translation units.
- Give collection capacity arithmetic checked failure behavior; no silent overflow.
- Keep the simple linear Map/Set implementation. It is readable, preserves insertion order, and
  is appropriate until profiling justifies a hash index.
- Add a differential fixture for every admitted method, including edge cases and mutations, not
  only the common path.
- Treat unsupported receiver/type combinations as validator diagnostics, never lowering or
  codegen ICEs. ICEs mean the allowlist admitted a program the semantic pipeline cannot handle.

## Recommended definition of done

A coherent first educational release does not need the whole roadmap. A strong stopping point is:

- scalar control flow, functions, closures, arrays, closed objects, and the existing class subset;
- complete errors and finally semantics;
- the Tier 1 standard library plus typed JSON;
- static local ESM modules;
- process arguments and small text fs/path APIs;
- async functions, await, timers, and a narrow fs/promises surface;
- precise compile-time rejection for everything else.

Generics, interface runtime dispatch, Date, regex, Promise combinators, and richer host APIs can
remain rejected indefinitely. Readability and a trustworthy boundary are product features here.
