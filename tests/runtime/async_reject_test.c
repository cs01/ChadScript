// Rejection resumption test for runtime/async.c: a fiber installs a try/catch handler (the exact
// ABI codegen emits) and awaits a promise that gets REJECTED. cs_await must throw the rejection into
// the fiber's handler chain — so the catch runs and the code after the await does NOT. Exits 0 on
// pass. (Single async chain, no interleaving — the concurrent-try-across-await case is a separate
// fiber-local-handler-stack item, see docs/async-gate-status.md.)
#include <stdint.h>
#include <stdio.h>
#include <gc.h>

typedef struct Promise Promise;
extern Promise *cs_promise_new(void);
extern void cs_promise_reject(Promise *p, void *reason);
extern Promise *cs_fiber_spawn(void (*body)(void *), void *arg);
extern int64_t cs_await(Promise *p);
extern void cs_run_event_loop(void);
// The synchronous-throw handler ABI, as codegen lowers try/catch (runtime.c).
extern void *cs_handler_alloc(void);
extern void cs_push_handler(void *h);
extern void cs_pop_handler(void);
extern int _setjmp(void *buf);

static Promise *shared;
static int caught = 0;
static int ran_after_await = 0;

static void body(void *arg) {
  (void)arg;
  void *h = cs_handler_alloc();
  cs_push_handler(h);
  if (_setjmp(h) == 0) {
    cs_await(shared);      // rejected → throws into this handler
    ran_after_await = 1;   // must NOT execute
    cs_pop_handler();
  } else {
    caught = 1;            // rejection caught
  }
}

int main(void) {
  GC_INIT();
  shared = cs_promise_new();
  cs_fiber_spawn(body, 0);                 // runs to the await, suspends as a waiter
  cs_promise_reject(shared, (void *)0x1);  // reject with a dummy non-null CsThrown*
  cs_run_event_loop();                     // resumes fiber → cs_await throws → caught

  if (!caught) { printf("FAIL: rejection was not caught by try/catch around await\n"); return 1; }
  if (ran_after_await) { printf("FAIL: code after a rejected await executed\n"); return 1; }
  return 0;
}
