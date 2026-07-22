# Async codegen wiring — implementation design

The async runtime (`runtime/async.c`) is correct and gate-closed (see `async-gate-status.md`). This
is the plan to connect it to lowering/codegen so `async`/`await` become part of the accepted subset,
closing the v2→main merge gate. Built in bounded, differential-tested slices.

## Runtime ABI recap (already implemented)

- `Promise *cs_fiber_spawn(void (*body)(void*), void *arg)` — runs `body(arg)` on a fresh fiber until
  its first `await`/return; returns the body's result `Promise*`.
- `void cs_fiber_return(int64_t boxedValue)` — the running fiber resolves its own result promise.
- `int64_t cs_await(Promise*)` — suspend until settled; returns the fulfilled boxed value, or throws
  the rejection into the fiber's handler chain.
- `Promise *cs_promise_resolved(int64_t)`, `cs_promise_reject(Promise*, void*)`.
- `void cs_run_event_loop(void)` — drain the microtask queue to completion.

Values cross as one boxed `int64` slot (number = double bits, pointer types as-is, bool 0/1 — the
same `boxSlot`/`unboxSlot` codegen already uses).

## The fiber-body ABI (the key mapping)

An async function is compiled as a **fiber body** `void <name>.fiber(void *env)`, NOT the ordinary
`T name(params)`:

1. `env` is a GC struct holding the call's arguments (like a closure env). The body loads params
   from it at entry.
2. The body runs the lowered statements. Each `await e` → `cs_await(<promise e>)` then unbox.
3. Every `return v` in an async body → `cs_fiber_return(boxSlot(v))` then return from the fiber body
   (a bare `return;` / fall-off → `cs_fiber_return(<undefined slot>)`).

Calling an async function `f(args)` (from anywhere) lowers to: pack `args` into a GC env struct,
`cs_fiber_spawn(&f.fiber, env)` → a `Promise<ret>` value. It does NOT run `f` synchronously to
completion; it runs to the first suspend (matching JS).

The env-pack + unpack reuses the existing closure ABI shape (hidden env pointer, fields by slot).

## HIR / type additions

- `ValueType` gains `{ kind: "promise", inner: ValueType }` — `irTypeOf` → `ptr` (a `Promise*`).
  `boxSlot`/`unboxSlot` treat it as a pointer.
- `HFunc` gains `async: boolean` (codegen emits the fiber-body form + return-via-`cs_fiber_return`).
- New `HExpr`: `{ kind: "await"; value: HExpr; type }` — value is `promise<T>`, result `T`.
- New `HExpr`: `{ kind: "asyncCall"; name; args; type: promise<T> }` (or reuse `call` with a flag) —
  lowers to the spawn.
- Validator: admit `AsyncKeyword` (function modifier) and `AwaitExpression`. `await` is only valid
  inside an async function (tsc already enforces this); a top-level `await` stays rejected for now.

## Top-level drive

`main` runs the top-level sync statements, then — if the program used async at all — calls
`cs_run_event_loop()` before returning its exit code, so queued microtasks (async bodies suspended at
`await`) run to completion, matching Node draining the microtask queue before exit.

## Slice plan (each: lower + codegen + a differential fixture in tests/fixtures/run/)

1. **No-arg async + await + log.** `async function f(): Promise<number> { return 42 } async function
   run(){ console.log(await f()) } run()`. Adds the promise type, the async HFunc form, `await`
   lowering, event-loop drive. Fixture diffs stdout vs Node.
2. **Async with parameters** (env pack/unpack).
3. **Rejection across await** — `throw` in an async body caught by `try/catch` around an `await`
   (runtime already supports it; wire the lowering).
4. **Ordering** — `await` yields a microtask, so synchronous code after an async call runs before the
   continuation. Fixture asserts interleaving matches Node.
5. **`Promise.resolve(x)`** as an expression.

Out of the initial release profile (keep rejected at validate): `setTimeout`/timers,
`Promise.all`/`race`/`allSettled`, real I/O, `for await` — these need the event loop's timer/IO
extension. See `async-gate-status.md`.

## Definition of done (merge gate)

Slices 1–4 green as differential fixtures (async program stdout+exit == Node), all existing suites
green, `docs/SUBSET.md` regenerated to include the admitted async syntax. At that point errors+async
are both met and v2 can merge to main.

## Slice 1 status (in progress)

The full lowering + codegen plumbing is implemented and committed but **async is still gated at
validate** (AsyncKeyword/AwaitExpression not yet in ALLOWED_KINDS), because a bug remains:

- WORKS end-to-end (verified manually): async functions with **parameters**, and up to **one
  `await` per async function body** (`async function f(n){ return n*2 } async function run(){
  console.log(await f(21)) } run()` prints 42, matching Node). The fiber-body ABI, env pack/unpack,
  `cs_fiber_return`, spawn-in-statement-position, and the top-level `cs_run_event_loop` drive all
  work.
- BROKEN: **two or more `await`s in a single async function body** — the second suspend-then-resume
  produces no output (a ucontext scheduling bug: reusing the single `cs_sched_ctx` as both the
  scheduler context and nested-spawn return target aliases when a resumed fiber suspends again).

Per the charter (no silent divergence), async stays rejected until multi-await works. Next: fix the
ucontext scheduling so a fiber can suspend→resume→suspend correctly (likely give the event loop a
dedicated context distinct from nested-spawn return targets, or drive all resumes from one loop
context). Then admit `async`/`await` + land the slice-1 differential fixture.
