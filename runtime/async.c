// Async runtime foundation (Phase 6, slice 1): Promises, stackful fibers, a microtask scheduler,
// and the event loop. See docs/async-design.md. Codegen wiring lands in the next slice; this file
// is the self-contained machinery those emitted calls target.
//
// Fibers use ucontext (makecontext/swapcontext): an async function body runs unmodified on its own
// stack, and `await` swaps back to the scheduler.
//
// GC + fiber stacks (subtle, load-bearing): Boehm scans exactly ONE stack per thread — from its
// stackbottom to the current SP. While a fiber runs, SP is on the fiber's stack, not the main one;
// while a fiber is suspended, its stack is off-thread entirely. Either way Boehm's normal scan does
// not cover a fiber's stack, so a value held only there (a boxed await result across a suspend, a
// local live across a nested spawn's GC_malloc) gets reclaimed — a GC-timing-dependent heisenbug
// (vanishes under GC_DONT_GC=1). We therefore allocate fiber stacks with plain malloc (NOT GC_malloc)
// and register each buffer as an explicit GC root, so the whole stack is scanned every collection
// regardless of where the SP is. Roots that fall inside the GC heap are ignored by Boehm — hence
// malloc, not GC_malloc. Retired stacks are NOT freed/unrooted (freeing a scanned region corrupts
// the collector); they go on a free-list and are reused, bounding memory by max-concurrent fibers.
// Do NOT swap GC's stackbottom to the fiber instead: that hides the MAIN stack from GC and drops
// main-stack roots.

#define _XOPEN_SOURCE 700
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
// ucontext is deprecated-but-functional on macOS and fully supported on Linux; silence the macOS
// deprecation noise (there is no portable replacement with the same "swap whole stack" semantics).
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#include <ucontext.h>
#include <gc.h>
#include <setjmp.h>
#include <stdio.h>

enum { CS_PENDING = 0, CS_FULFILLED = 1, CS_REJECTED = 2 };

typedef struct Fiber Fiber;

// A promise's waiter: a suspended fiber to resume (as a microtask) once the promise settles.
typedef struct Waiter {
  Fiber *fiber;
  struct Waiter *next;
} Waiter;

typedef struct Promise {
  int state;
  int64_t value; // boxed i64 slot (same boxing as arrays/maps) once fulfilled
  void *reason;  // the rejection value: a CsThrown* (opaque here), thrown into an awaiter
  Waiter *waiters;
  int unhandled; // set when rejected with no waiter to consume it; cleared when an await consumes it
} Promise;

// The exception machinery lives in runtime.c; a rejected `await` throws into the awaiting fiber via
// the same handler chain as a synchronous `throw`, so `try/catch` around `await` catches it.
extern void cs_throw(void *thrown);
// The handler stack is swappable so each fiber runs with its OWN try/catch chain (concurrent
// try-across-await must not corrupt each other). We save/install a fiber's stack around every run.
extern void cs_handler_ctx_get(void ***stack, int *n, int *cap);
extern void cs_handler_ctx_set(void **stack, int n, int cap);
// A fiber installs a ROOT handler so a throw that escapes its body rejects its result promise
// (instead of terminating the process). `cs_handler_alloc` returns a CsHandler* whose first member
// IS the jmp_buf, so it is usable directly as a setjmp target; `cs_handler_thrown` reads the value.
extern void *cs_handler_alloc(void);
extern void cs_push_handler(void *h);
extern void cs_pop_handler(void);
extern void *cs_handler_thrown(void *h);

struct Fiber {
  ucontext_t ctx;
  void (*body)(void *);
  void *arg;
  Promise *result;      // resolved with the body's return value on completion
  int64_t resumeVal;    // value handed to the fiber when the scheduler resumes it
  ucontext_t *ret_ctx;  // where to switch back on suspend/completion (the caller that entered us —
                        // the scheduler, OR an outer fiber that spawned us synchronously)
  int done;
  // This fiber's own exception-handler stack (empty until it enters a `try`). Saved here while the
  // fiber is suspended; installed as the active stack while it runs.
  void **h_stack;
  int h_n;
  int h_cap;
};

// The scheduler's own context (the "main" stack the event loop runs on) and the currently running
// fiber. A single global scheduler is enough — this runtime is single-threaded, like Node.
static ucontext_t cs_sched_ctx;
static Fiber *cs_current_fiber = NULL;

#define CS_FIBER_STACK (256 * 1024)

// A fiber stack: plain malloc (NOT GC_malloc — Boehm ignores roots inside its own heap) registered
// as an explicit GC root so the whole buffer is scanned every collection regardless of where the SP
// is (see the file header). Stacks are NEVER freed or recycled: freeing a scanned region corrupts
// the collector, and recycling a just-retired stack onto the next spawn is unsafe while an ancestor
// fiber is still suspended (a nested child's stack reused by a concurrent sibling breaks it). So each
// spawn allocates a fresh rooted stack — memory grows with total async invocations. TODO: a safe
// pool (recycle only once a fiber is provably unreferenced) would bound this.
static void *cs_get_stack(void) {
  void *stk = malloc(CS_FIBER_STACK);
  GC_add_roots(stk, (char *)stk + CS_FIBER_STACK);
  return stk;
}

// Run `f` (via a swap from context `from`) with ITS handler stack active: save the caller's stack,
// install the fiber's, run until it yields, then save the fiber's back and restore the caller's.
// Every entry into a fiber (initial spawn + each event-loop resume) goes through here.
static void cs_enter_fiber(Fiber *f, ucontext_t *from) {
  void **savedStack;
  int savedN, savedCap;
  cs_handler_ctx_get(&savedStack, &savedN, &savedCap);
  cs_handler_ctx_set(f->h_stack, f->h_n, f->h_cap);
  Fiber *prev = cs_current_fiber;
  cs_current_fiber = f;
  f->ret_ctx = from; // the fiber suspends/completes back to whoever entered it
  swapcontext(from, &f->ctx);
  cs_current_fiber = prev;
  cs_handler_ctx_get(&f->h_stack, &f->h_n, &f->h_cap); // the fiber's stack may have grown
  cs_handler_ctx_set(savedStack, savedN, savedCap);
}


// Microtask queue: fibers ready to run, FIFO. A GROWABLE ring buffer — an explicit `count`
// distinguishes full from empty (the old fixed 4096 ring had no overflow check: a full queue looked
// empty and silently dropped tasks). When full it doubles, so it is never lossy regardless of how
// many microtasks a program queues.
static Fiber **cs_mtq = NULL;
static int cs_mtq_cap = 0, cs_mtq_head = 0, cs_mtq_tail = 0, cs_mtq_count = 0;

static void cs_mtq_push(Fiber *f) {
  if (cs_mtq_count == cs_mtq_cap) {
    int newcap = cs_mtq_cap ? cs_mtq_cap * 2 : 64;
    Fiber **nb = GC_malloc((size_t)newcap * sizeof(Fiber *));
    for (int i = 0; i < cs_mtq_count; i++) nb[i] = cs_mtq[(cs_mtq_head + i) % cs_mtq_cap];
    cs_mtq = nb;
    cs_mtq_cap = newcap;
    cs_mtq_head = 0;
    cs_mtq_tail = cs_mtq_count;
  }
  cs_mtq[cs_mtq_tail] = f;
  cs_mtq_tail = (cs_mtq_tail + 1) % cs_mtq_cap;
  cs_mtq_count++;
}
static Fiber *cs_mtq_pop(void) {
  if (cs_mtq_count == 0) return NULL;
  Fiber *f = cs_mtq[cs_mtq_head];
  cs_mtq_head = (cs_mtq_head + 1) % cs_mtq_cap;
  cs_mtq_count--;
  return f;
}

Promise *cs_promise_new(void) {
  Promise *p = GC_malloc(sizeof(Promise));
  p->state = CS_PENDING;
  p->value = 0;
  p->reason = NULL;
  p->waiters = NULL;
  p->unhandled = 0;
  return p;
}

// Count of rejections not yet consumed by an await. Node exits 1 on an unhandled promise rejection;
// we approximate that: a rejection with no waiter is tentatively unhandled, an await that consumes a
// rejected promise clears it, and the event loop exits 1 if any survive to the end.
static int cs_unhandled_count = 0;

// Settle a promise and schedule its waiters as microtasks carrying the value.
void cs_promise_resolve(Promise *p, int64_t boxedValue) {
  if (p->state != CS_PENDING) return;
  p->state = CS_FULFILLED;
  p->value = boxedValue;
  for (Waiter *w = p->waiters; w; w = w->next) {
    w->fiber->resumeVal = boxedValue;
    cs_mtq_push(w->fiber);
  }
  p->waiters = NULL;
}

Promise *cs_promise_resolved(int64_t boxedValue) {
  Promise *p = cs_promise_new();
  cs_promise_resolve(p, boxedValue);
  return p;
}

// Reject a promise with a thrown value (a CsThrown*). Waiters are still scheduled as microtasks;
// each awaiter, on resume, sees the REJECTED state and throws `reason` into its own handler chain.
void cs_promise_reject(Promise *p, void *reason) {
  if (p->state != CS_PENDING) return;
  p->state = CS_REJECTED;
  p->reason = reason;
  // No waiter registered at reject time → tentatively unhandled (a later await clears it). With
  // waiters, the resuming await will consume the rejection, so it is already accounted for.
  if (!p->waiters) {
    p->unhandled = 1;
    cs_unhandled_count++;
  }
  for (Waiter *w = p->waiters; w; w = w->next) cs_mtq_push(w->fiber);
  p->waiters = NULL;
}

// The trampoline every fiber's stack starts in: run the body, resolve the result, return to the
// scheduler. `body` is the compiled async function (it resolves nothing itself; its return value
// is resolved here via cs_fiber_return).
static void cs_fiber_trampoline(void) {
  // Install a root handler: a throw escaping the body (an unhandled exception in the async function,
  // including a rejection re-thrown by an inner `await`) rejects THIS fiber's result promise, so the
  // awaiter sees a rejected promise instead of the process aborting. cs_current_fiber is always this
  // fiber while trampoline code runs, so re-reading it after the longjmp is safe.
  void *root = cs_handler_alloc();
  cs_push_handler(root);
  if (_setjmp(*(jmp_buf *)root) == 0) {
    cs_current_fiber->body(cs_current_fiber->arg); // resolves its own result via cs_fiber_return
    cs_pop_handler();
  } else {
    cs_promise_reject(cs_current_fiber->result, cs_handler_thrown(root));
  }
  cs_current_fiber->done = 1;
  // Back to whoever entered us; we will not be resumed again.
  swapcontext(&cs_current_fiber->ctx, cs_current_fiber->ret_ctx);
}

// Called by an async function body (codegen) at its return: resolve this fiber's result promise.
void cs_fiber_return(int64_t boxedValue) {
  if (cs_current_fiber) cs_promise_resolve(cs_current_fiber->result, boxedValue);
}

// Spawn a fiber running `body(arg)`; returns its result promise. Runs the fiber immediately until
// its first suspend or completion (JS: an async call runs synchronously up to the first await).
Promise *cs_fiber_spawn(void (*body)(void *), void *arg) {
  Fiber *f = GC_malloc(sizeof(Fiber));
  f->body = body;
  f->arg = arg;
  f->result = cs_promise_new();
  f->done = 0;
  f->resumeVal = 0;
  f->h_stack = NULL; // a fresh, empty handler stack
  f->h_n = 0;
  f->h_cap = 0;
  getcontext(&f->ctx);
  f->ctx.uc_stack.ss_sp = cs_get_stack(); // malloc'd + rooted (or reused); see the file header note
  f->ctx.uc_stack.ss_size = CS_FIBER_STACK;
  f->ctx.uc_link = &cs_sched_ctx;
  makecontext(&f->ctx, cs_fiber_trampoline, 0);

  ucontext_t *from = cs_current_fiber ? &cs_current_fiber->ctx : &cs_sched_ctx;
  cs_enter_fiber(f, from); // run until first suspend/completion, with f's handler stack
  return f->result;
}

// Promise.all: await each input promise, collect the fulfilled values into an array (in input
// order), and resolve with it; the FIRST rejection reached rejects the whole (cs_await rethrows into
// this driver fiber, whose root handler rejects its result — exactly Promise.all's reject semantics).
// Implemented as an ordinary async body run on a fiber: cs_fiber_spawn returns the driver's result
// promise, which IS the Promise.all promise. The input array's slots are boxed Promise* pointers; the
// output array's slots are the boxed element values (same boxing the awaiter unboxes as T[]).
extern void *cs_array_new(void);
extern int cs_array_push(void *a, int64_t slot);
extern int cs_array_len(void *a);
extern int64_t cs_array_get(void *a, int i);
int64_t cs_await(Promise *p); // defined below

static void cs_all_driver(void *arg) {
  void *promises = arg;
  int n = cs_array_len(promises);
  void *results = cs_array_new();
  for (int i = 0; i < n; i++) {
    Promise *p = (Promise *)(intptr_t)cs_array_get(promises, i);
    int64_t v = cs_await(p); // suspends; a rejection throws → rejects this driver's result
    cs_array_push(results, v);
  }
  cs_fiber_return((int64_t)(intptr_t)results);
}

Promise *cs_promise_all(void *promises) { return cs_fiber_spawn(cs_all_driver, promises); }

// await(p): if pending, register + suspend until it settles; if already settled, still yield a
// microtask so ordering matches Node (later synchronous code runs before the continuation). On a
// FULFILLED promise, returns its boxed value; on a REJECTED one, THROWS `reason` into this fiber's
// handler chain (so a `try/catch` around the await catches it), exactly like a synchronous throw.
int64_t cs_await(Promise *p) {
  Fiber *self = cs_current_fiber;
  if (p->state == CS_PENDING) {
    Waiter *w = GC_malloc(sizeof(Waiter));
    w->fiber = self;
    w->next = NULL;
    // Append to the TAIL so multiple awaiters of one promise resume in registration order (FIFO),
    // matching JS. (Front-insertion here would resume them LIFO.) Waiter lists are short.
    if (!p->waiters) {
      p->waiters = w;
    } else {
      Waiter *t = p->waiters;
      while (t->next) t = t->next;
      t->next = w;
    }
    swapcontext(&self->ctx, self->ret_ctx); // suspend until settled
  } else {
    // Already settled: still yield a microtask to preserve ordering.
    self->resumeVal = p->value;
    cs_mtq_push(self);
    swapcontext(&self->ctx, self->ret_ctx);
  }
  // Resumed: the promise is now settled. A rejection surfaces as a throw into this fiber; consuming
  // it here clears its unhandled mark (the throw may re-reject THIS fiber's result, which is tracked
  // separately, so the unhandled count correctly moves up the await chain).
  if (p->state == CS_REJECTED) {
    if (p->unhandled) {
      p->unhandled = 0;
      cs_unhandled_count--;
    }
    cs_throw(p->reason);
  }
  return p->value;
}

// Drain the microtask queue, resuming each ready fiber. (Timers/IO extend this in a later slice.)
void cs_run_event_loop(void) {
  Fiber *f;
  while ((f = cs_mtq_pop()) != NULL) {
    if (f->done) continue;
    cs_enter_fiber(f, &cs_sched_ctx); // resume with the fiber's own handler stack installed
  }
  // A rejection that no await ever consumed → Node terminates with exit code 1. stderr text is
  // best-effort (the harness compares stdout + exit code only).
  if (cs_unhandled_count > 0) {
    fputs("Uncaught (in promise)\n", stderr);
    exit(1);
  }
}
