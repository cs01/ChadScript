// Async runtime foundation (Phase 6, slice 1): Promises, stackful fibers, a microtask scheduler,
// and the event loop. See docs/async-design.md. Codegen wiring lands in the next slice; this file
// is the self-contained machinery those emitted calls target.
//
// Fibers use ucontext (makecontext/swapcontext): an async function body runs unmodified on its own
// stack, and `await` swaps back to the scheduler. Boehm GC scans fiber stacks conservatively
// (they are GC-allocated), so values live across a suspend stay rooted.

#define _XOPEN_SOURCE 700
#include <stdint.h>
#include <stddef.h>
// ucontext is deprecated-but-functional on macOS and fully supported on Linux; silence the macOS
// deprecation noise (there is no portable replacement with the same "swap whole stack" semantics).
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#include <ucontext.h>
#include <gc.h>

enum { CS_PENDING = 0, CS_FULFILLED = 1, CS_REJECTED = 2 };

typedef struct Fiber Fiber;

// A promise's waiter: a suspended fiber to resume (as a microtask) once the promise settles.
typedef struct Waiter {
  Fiber *fiber;
  struct Waiter *next;
} Waiter;

typedef struct Promise {
  int state;
  int64_t value;      // boxed i64 slot (same boxing as arrays/maps) once fulfilled
  const char *reason; // rejection message
  Waiter *waiters;
} Promise;

struct Fiber {
  ucontext_t ctx;
  void (*body)(void *);
  void *arg;
  Promise *result;  // resolved with the body's return value on completion
  int64_t resumeVal; // value handed to the fiber when the scheduler resumes it
  int done;
};

// The scheduler's own context (the "main" stack the event loop runs on) and the currently running
// fiber. A single global scheduler is enough — this runtime is single-threaded, like Node.
static ucontext_t cs_sched_ctx;
static Fiber *cs_current_fiber = NULL;

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
  return p;
}

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

// The trampoline every fiber's stack starts in: run the body, resolve the result, return to the
// scheduler. `body` is the compiled async function (it resolves nothing itself; its return value
// is resolved here via cs_fiber_return).
static void cs_fiber_trampoline(void) {
  Fiber *self = cs_current_fiber;
  self->body(self->arg);
  self->done = 1;
  // Back to the scheduler; it will not resume this fiber again.
  swapcontext(&self->ctx, &cs_sched_ctx);
}

// Called by an async function body (codegen) at its return: resolve this fiber's result promise.
void cs_fiber_return(int64_t boxedValue) {
  if (cs_current_fiber) cs_promise_resolve(cs_current_fiber->result, boxedValue);
}

#define CS_FIBER_STACK (256 * 1024)

// Spawn a fiber running `body(arg)`; returns its result promise. Runs the fiber immediately until
// its first suspend or completion (JS: an async call runs synchronously up to the first await).
Promise *cs_fiber_spawn(void (*body)(void *), void *arg) {
  Fiber *f = GC_malloc(sizeof(Fiber));
  f->body = body;
  f->arg = arg;
  f->result = cs_promise_new();
  f->done = 0;
  f->resumeVal = 0;
  getcontext(&f->ctx);
  f->ctx.uc_stack.ss_sp = GC_malloc(CS_FIBER_STACK);
  f->ctx.uc_stack.ss_size = CS_FIBER_STACK;
  f->ctx.uc_link = &cs_sched_ctx;
  makecontext(&f->ctx, cs_fiber_trampoline, 0);

  Fiber *prev = cs_current_fiber;
  cs_current_fiber = f;
  swapcontext(&cs_sched_ctx, &f->ctx); // run until first suspend/completion
  cs_current_fiber = prev;
  return f->result;
}

// await(p): if pending, register + suspend; either way yield a microtask so ordering matches Node
// (later synchronous code runs before the continuation). Returns the fulfilled boxed value.
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
    swapcontext(&self->ctx, &cs_sched_ctx); // suspend until resolved
    return self->resumeVal;
  }
  // Already settled: still yield a microtask to preserve ordering.
  self->resumeVal = p->value;
  cs_mtq_push(self);
  swapcontext(&self->ctx, &cs_sched_ctx);
  return self->resumeVal;
}

// Drain the microtask queue, resuming each ready fiber. (Timers/IO extend this in a later slice.)
void cs_run_event_loop(void) {
  Fiber *f;
  while ((f = cs_mtq_pop()) != NULL) {
    if (f->done) continue;
    Fiber *prev = cs_current_fiber;
    cs_current_fiber = f;
    swapcontext(&cs_sched_ctx, &f->ctx);
    cs_current_fiber = prev;
  }
}
