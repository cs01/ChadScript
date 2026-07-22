# Async design (Phase 6)

Status: design. Implementation lands in slices behind this doc (PLAN's design-doc-first gate).

## Why this is not optional-shaped

`await` must **suspend** a function mid-body and resume it later, and the resume must be ordered
as a microtask — Node runs later synchronous code before an awaited continuation:

```ts
async function main() { console.log(1); await Promise.resolve(); console.log(2); }
main(); console.log(3);         // Node prints 1, 3, 2
```

A naive "run eagerly, unwrap the resolved value" implementation prints `1, 2, 3` — a divergence
from the oracle, so it is disqualified. Real suspension + a microtask queue are required from the
first slice.

## Representation: stackful fibers (not a state-machine transform)

TS/C#/Rust split each async function into a resumable state machine. That is a large HIR
transform. We instead use **stackful coroutines (fibers)** via `ucontext` (`makecontext` /
`swapcontext`), because:

- The async function body needs **no transform** — it runs as ordinary compiled code on its own
  stack. `await` is just "swap back to the scheduler."
- We already lower everything through allocas (memory, not SSA across suspension points), so a
  fiber switch is safe (no live SSA values to spill — they are in the fiber's stack).
- Boehm GC already scans the C stack conservatively; each fiber stack is registered so its roots
  stay alive across a suspend.

Cost: one heap stack per in-flight async call. Fine for an educational/experimental compiler; a
state-machine transform is a later optimization if it ever matters.

## Runtime pieces (C, `runtime/async.c`)

1. **Promise** — `{ int state; int64_t value; Waiter* waiters; }` where state ∈
   {PENDING, FULFILLED, REJECTED}. `value` is a boxed i64 slot (same boxing as arrays/maps).
   `cs_promise_new`, `cs_promise_resolve(p, boxedValue)`, `cs_promise_reject(p, msg)`.
2. **Fiber** — `{ ucontext_t ctx; char* stack; Promise* result; }`. `cs_fiber_spawn(fn, arg)`
   allocates a stack, `makecontext`s it to run `fn(arg)`, and switches into it. The entry
   trampoline resolves `result` with the body's return value when the body completes.
3. **Scheduler** — a FIFO **microtask queue** of ready fibers + a resolved-value to hand each. The
   event loop drains microtasks, then (Phase 6b) polls timers/IO. `cs_run_event_loop()` is the
   program's final act (after `main`'s top-level statements), draining until nothing is pending.
4. **await(p)** — if `p` is settled, return its value (still yielding a microtask to preserve
   ordering); if pending, register the current fiber as a waiter on `p` and `swapcontext` back to
   the scheduler. When `p` settles, `cs_promise_resolve` enqueues each waiter fiber as a microtask
   carrying the value. Rejection resumes the fiber such that `await` re-`throw`s (ties into the
   existing setjmp/longjmp exception path).

## Lowering (frontend)

- `Promise<T>` → a new `ValueType { kind: "promise", inner }` (ptr-represented).
- `async function f(...): Promise<T>` → an ordinary HFunc whose body is run inside a fiber. `new`
  is not involved; calling `f(args)` lowers to `cs_fiber_spawn(@f.impl, packedArgs)` returning the
  fiber's result Promise. The body's `return x` resolves the result Promise (codegen wraps the
  function so its tail resolves).
- `await e` → `HExpr { kind: "await", promise, type: T }`; codegen calls `cs_await(promise)` which
  returns the (unboxed) value or re-throws on rejection.
- `Promise.resolve(v)` / `Promise.reject(e)` → settled promises. `Promise.all([...])` later.

## Ordering guarantee

Every `await` (even on an already-settled promise) yields one microtask, and `.then`-equivalent
continuations enqueue as microtasks — so the interleaving of sync code vs continuations matches
Node's microtask semantics. The differential harness (stdout + exit, O0 + O2) is the check.

## Implementation slices

1. **Runtime foundation** — `runtime/async.c`: Promise + fiber + microtask scheduler + event loop.
   Unit-testable in C before any codegen.
2. **Frontend types + await** — `Promise<T>` ValueType, `async function`, `await`, `Promise.resolve`.
   Event loop invoked after top-level. Microtask ordering matches Node.
3. **Timers** — `setTimeout`/`setInterval` via a timer heap (libuv later, a simple heap first),
   extending the event loop past microtasks.
4. **Breadth** — `Promise.all`/`race`/`allSettled`, `async` arrow/methods, `for await`, rejection
   → `await` throwing, `fs/promises` subset.

Slice 1 is next.
