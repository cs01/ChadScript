// Fiber-local handler stack test: two fibers each run their own `try { await } catch`, both suspend
// (each with its handler on the stack), then both promises reject. Each fiber must catch ITS OWN
// rejection. With a single GLOBAL handler stack, fiber A's throw would pop fiber B's handler (top of
// the shared stack) and longjmp into B's suspended frame — misrouted/corrupt. Exits 0 on pass.
#include <stdint.h>
#include <stdio.h>
#include <gc.h>

typedef struct Promise Promise;
extern Promise *cs_promise_new(void);
extern void cs_promise_reject(Promise *p, void *reason);
extern Promise *cs_fiber_spawn(void (*body)(void *), void *arg);
extern int64_t cs_await(Promise *p);
extern void cs_run_event_loop(void);
extern void *cs_handler_alloc(void);
extern void cs_push_handler(void *h);
extern void cs_pop_handler(void);
extern int _setjmp(void *buf);

static Promise *pa, *pb;
static int caughtA = 0, caughtB = 0, afterA = 0, afterB = 0;

static void bodyA(void *arg) {
  (void)arg;
  void *h = cs_handler_alloc();
  cs_push_handler(h);
  if (_setjmp(h) == 0) { cs_await(pa); afterA = 1; cs_pop_handler(); }
  else caughtA = 1;
}
static void bodyB(void *arg) {
  (void)arg;
  void *h = cs_handler_alloc();
  cs_push_handler(h);
  if (_setjmp(h) == 0) { cs_await(pb); afterB = 1; cs_pop_handler(); }
  else caughtB = 1;
}

int main(void) {
  GC_INIT();
  pa = cs_promise_new();
  pb = cs_promise_new();
  cs_fiber_spawn(bodyA, 0); // suspends inside its try, on pa
  cs_fiber_spawn(bodyB, 0); // suspends inside its try, on pb
  cs_promise_reject(pa, (void *)0x1);
  cs_promise_reject(pb, (void *)0x2);
  cs_run_event_loop();

  if (!caughtA || !caughtB) { printf("FAIL: caughtA=%d caughtB=%d (handler misroute?)\n", caughtA, caughtB); return 1; }
  if (afterA || afterB) { printf("FAIL: code after a rejected await ran\n"); return 1; }
  return 0;
}
