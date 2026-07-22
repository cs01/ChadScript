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

The full lowering + codegen plumbing is implemented and committed. Async stays **gated at validate**
(AsyncKeyword/AwaitExpression not yet in ALLOWED_KINDS) — one codegen gap remains — but the two hard
runtime problems are now SOLVED and verified in the real compiler (native output diffed vs Node):

- ✅ **Multi-await was NOT a scheduler bug** (the earlier hypothesis of `cs_sched_ctx` aliasing was
  wrong). It was a **GC bug**: fiber stacks live off the main thread stack, so Boehm's normal
  one-stack-per-thread scan never covers them; a collection triggered while a fiber ran (a
  `GC_malloc` inside a nested spawn) reclaimed values/roots held only on the suspended fiber's stack,
  breaking its resumption. GC-timing-dependent — `GC_DONT_GC=1` masked it. Confirmed via a standalone
  C repro and by the compiler oracle: `const a=await g(); ...; const b=await g()` printed nothing on
  the pristine runtime (0/5 vs Node) and prints correctly after the fix (5/5). Fix in `async.c`:
  allocate fiber stacks with plain `malloc` and register each as an explicit GC root (roots inside
  the GC heap are ignored, so `GC_malloc` won't do); retired stacks go on a free-list and are reused,
  never freed (freeing a scanned region corrupts Boehm) — memory is bounded by max-concurrent fibers.
  Do NOT instead swap GC's stackbottom to the fiber: that hides the MAIN stack from GC (7/8 flaky).
  Now verified 5/5 vs Node: multi-await, params, `await` in a `for` loop, nested async chains.
- ✅ **Fiber rejection plumbed**: `cs_fiber_trampoline` installs a root handler so a throw escaping an
  async body rejects that body's result promise (instead of `exit(1)`); an awaiter then observes the
  rejection. Pinned by `tests/runtime/async_fiber_throw_test.c`.

Remaining before admission (next slice):

- ⛔ **`await` inside a `try` block ICEs in codegen** (`irTypeOf: undefined has no storage
  representation`) — the try/catch × await lowering is incomplete. This is the only blocker for the
  working subset; until it is fixed, admitting async would let a `try { await … }` program fail to
  compile (acceptable) OR, worse, admit throw-in-async whose **unhandled** top-level rejection exits 0
  where Node exits 1 (a divergence). So async stays fully gated rather than half-admitted.
- Then: handle unhandled top-level rejection (exit 1 like Node), admit `async`/`await`, and land the
  differential fixtures (multi-await / params / loop / chain / rejection-caught) — the real
  regression guard the C tests can only approximate.
