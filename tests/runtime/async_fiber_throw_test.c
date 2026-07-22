// A throw that escapes an async function body must REJECT that function's result promise (not abort
// the process), so an awaiter of it observes a rejection. Pins the root handler cs_fiber_trampoline
// installs around every fiber body. On the old runtime (no root handler) the child's uncaught throw
// hit cs_throw with an empty handler stack and called exit(1); here it is caught by the parent's
// try/catch around the await. Exits 0 on pass.
#include <stdint.h>
#include <stdio.h>
#include <gc.h>

typedef struct Promise Promise;
extern Promise *cs_fiber_spawn(void (*body)(void *), void *arg);
extern int64_t cs_await(Promise *p);
extern void cs_run_event_loop(void);
extern void cs_throw(void *thrown);
extern void *cs_handler_alloc(void);
extern void cs_push_handler(void *h);
extern void cs_pop_handler(void);
extern int _setjmp(void *buf);

static int caught = 0, ran_after = 0;

static void child(void *arg) {
  (void)arg;
  cs_throw((void *)0x1234); // uncaught within the child → its result promise must reject
}

static void parent(void *arg) {
  (void)arg;
  Promise *c = cs_fiber_spawn(child, 0); // child runs, throws; result promise now rejected
  void *h = cs_handler_alloc();
  cs_push_handler(h);
  if (_setjmp(h) == 0) {
    cs_await(c);     // rejected → throws into this handler
    ran_after = 1;   // must NOT run
    cs_pop_handler();
  } else {
    caught = 1;
  }
}

int main(void) {
  GC_INIT();
  cs_fiber_spawn(parent, 0);
  cs_run_event_loop();
  if (!caught) { printf("FAIL: escaping throw did not reject the fiber's result promise\n"); return 1; }
  if (ran_after) { printf("FAIL: code after a rejected await ran\n"); return 1; }
  return 0;
}
