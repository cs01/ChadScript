// C-level test for runtime/async.c (async isn't reachable via codegen yet, so no differential
// path). Registers three fibers awaiting the SAME pending promise, resolves it, drains the event
// loop, and asserts they resume in REGISTRATION order (FIFO) — not the LIFO order a front-inserting
// waiter list would produce. Exits 0 on pass, non-zero on failure.
#include <stdint.h>
#include <stdio.h>
#include <gc.h>

typedef struct Promise Promise;
extern Promise *cs_promise_new(void);
extern void cs_promise_resolve(Promise *p, int64_t boxedValue);
extern Promise *cs_fiber_spawn(void (*body)(void *), void *arg);
extern int64_t cs_await(Promise *p);
extern void cs_run_event_loop(void);

static Promise *shared;   // the pending promise all fibers await
static int order[8];      // resume order, by fiber id
static int order_n = 0;

static void body(void *arg) {
  int id = (int)(intptr_t)arg;
  cs_await(shared);       // suspends until shared resolves
  order[order_n++] = id;  // record resume order
}

int main(void) {
  GC_INIT();
  shared = cs_promise_new();
  // Spawn in id order 1,2,3 — each runs to its await and registers a waiter.
  cs_fiber_spawn(body, (void *)(intptr_t)1);
  cs_fiber_spawn(body, (void *)(intptr_t)2);
  cs_fiber_spawn(body, (void *)(intptr_t)3);
  cs_promise_resolve(shared, 0);
  cs_run_event_loop();

  if (order_n != 3) { printf("FAIL: %d resumed, expected 3\n", order_n); return 1; }
  for (int i = 0; i < 3; i++) {
    if (order[i] != i + 1) {
      printf("FAIL: resumed [%d,%d,%d], expected [1,2,3] (LIFO waiters?)\n",
             order[0], order[1], order[2]);
      return 1;
    }
  }
  return 0;
}
