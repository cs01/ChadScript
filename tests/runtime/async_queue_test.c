// Stress test for runtime/async.c's microtask queue: spawn N fibers (N far exceeds the initial ring
// capacity, forcing the growable queue to expand) all awaiting the SAME pending promise. On resolve
// every waiter is queued as a microtask; draining must resume ALL of them, in registration order.
// The old fixed 4096 ring with no overflow check would silently drop tasks. Exits 0 on pass.
#include <stdint.h>
#include <stdio.h>
#include <gc.h>

#define N 200  // > the queue's initial capacity (64), so growth is exercised

typedef struct Promise Promise;
extern Promise *cs_promise_new(void);
extern void cs_promise_resolve(Promise *p, int64_t boxedValue);
extern Promise *cs_fiber_spawn(void (*body)(void *), void *arg);
extern int64_t cs_await(Promise *p);
extern void cs_run_event_loop(void);

static Promise *shared;
static int order[N];
static int order_n = 0;

static void body(void *arg) {
  int id = (int)(intptr_t)arg;
  cs_await(shared);
  if (order_n < N) order[order_n++] = id;
}

int main(void) {
  GC_INIT();
  shared = cs_promise_new();
  for (int i = 0; i < N; i++) cs_fiber_spawn(body, (void *)(intptr_t)i);
  cs_promise_resolve(shared, 0);
  cs_run_event_loop();

  if (order_n != N) { printf("FAIL: %d/%d resumed (lossy queue?)\n", order_n, N); return 1; }
  for (int i = 0; i < N; i++) {
    if (order[i] != i) { printf("FAIL: order[%d]=%d, expected %d\n", i, order[i], i); return 1; }
  }
  return 0;
}
