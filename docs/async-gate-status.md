# Async gate status (review order #7)

The architecture review keeps async **behind a design gate**: the runtime prototype
(`runtime/async.c`, `docs/async-design.md`) must satisfy the items below — each with focused runtime
+ differential tests — **before** async is wired into lowering/codegen. This is the reassessment.

Async codegen is **still gated**. Errors (Phase 5) are done; async is the remaining v2→main merge
blocker. This document is the checked to-do list for closing it.

## Gate items

| Item | Status | Evidence / gap |
| ---- | ------ | -------------- |
| Fiber-local exception state | ✅ done | Phase 5 — thrown message lives in the `CsHandler` frame, not a global; re-raise reads the outer frame. |
| Structured completions | ✅ done | Phase 5 — return/break/continue route through `finally`, chained + overridable. |
| Stackful fibers | ✅ basic | `runtime/async.c` — ucontext (`makecontext`/`swapcontext`); async body runs on its own 256 KiB GC stack. |
| Rooting | ✅ basic | Boehm scans fiber stacks conservatively; the microtask ring and `cs_current_fiber` are static roots. Needs a written invariant + a stress test that a suspended fiber's locals survive GC. |
| FIFO waiters | ✅ done | `cs_await` now appends to the waiter-list tail, so awaiters resume in registration order. Pinned by `tests/runtime/async_fifo_test.c` (a C harness — async isn't differential-testable until codegen) run from `tests/unit/async-runtime.test.ts`. |
| Non-lossy microtask queue | ✅ done | `cs_mtq` is now a GROWABLE ring with an explicit `count` (full ≠ empty); it doubles when full, so no task is ever dropped. Pinned by `tests/runtime/async_queue_test.c` (200 awaiters, past the initial capacity → growth). |
| Rejection resumption | ✅ done | `cs_promise_reject` settles a promise with a `CsThrown*` and schedules its waiters; `cs_await`, on resuming a REJECTED promise, calls `cs_throw(reason)` — surfacing the rejection through the same handler chain as a synchronous `throw`, so `try/catch` around `await` catches it. Pinned by `tests/runtime/async_reject_test.c`. |
| Fiber-local handler stack | ✅ done | The handler stack (runtime.c) is now a swappable growable array (`cs_handler_ctx_get`/`set`); async's `cs_enter_fiber` saves the caller's stack and installs the fiber's around every run, so concurrent `try/catch` blocks suspended across `await` each catch their own rejection. Pinned by `tests/runtime/async_concurrent_reject_test.c`; synchronous try/catch unaffected (differential suite green). |
| Boxing rules | ⚠️ unspecified | Promise values cross as a single `int64_t boxedValue`. Need an explicit per-type boxing spec (number = double bits, pointer types as-is, matching the array-slot boxing in codegen) and a test per type round-tripping through resolve/await. |
| Portability | ⚠️ noted | ucontext is deprecated-but-functional on macOS, supported on Linux. Acceptable short-term; document the constraint and keep a fallback path in mind. |
| Codegen wiring | ⛔ gated | Not started by design — async function lowering, `await` lowering, the top-level event-loop drive. Do NOT start until the ❌ items are fixed and the ⚠️ items specified + tested. |

## Ordered plan to close the gate

1. **FIFO waiters** — fix ordering; C-level test resuming N awaiters in registration order.
2. **Non-lossy microtask queue** — growable ring (or documented hard cap with abort); test > cap.
3. **Rejection resumption** — `cs_promise_reject` + `await`-throws-into-fiber, reusing the Phase-5
   fiber-local exception state; test resolve-then-reject and await-on-rejected.
4. **Boxing rules** — write the spec; per-type round-trip tests.
5. **Rooting invariant** — write it down; GC-stress a suspended fiber.
6. Only then: **async codegen wiring**, gated on all of the above, each with differential fixtures
   (async program vs Node stdout/exit).

## Release-profile proposal

Ship the **smallest useful async surface** first, not full Node async:

- `async function` + `await` on a `Promise<T>` value, `Promise.resolve`, and the top-level drive of
  the microtask queue to completion.
- Rejection via `throw` inside an async body caught by `try/catch` across `await`.
- **Out of the initial profile** (reject at validate until later): timers (`setTimeout`),
  `Promise.all`/`race`/`allSettled`, real I/O, `for await`. These need the event loop's timer/IO
  extension, which the current `cs_run_event_loop` explicitly defers.

This profile is end-to-end differential-testable (async programs that resolve/await/reject and print,
compared to Node) and is enough to call the errors+async merge gate met.
