// Boxing round-trip: a promise carries its value as one int64 "boxed slot" (the same boxing codegen
// uses for array/map elements — number = the double's bits, pointer = the pointer, bool = 0/1). The
// runtime stores/returns those bits verbatim; this pins that a value survives resolve→await intact
// for each representation. Runs inside a fiber (await requires one). Exits 0 on pass.
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <gc.h>

typedef struct Promise Promise;
extern Promise *cs_promise_resolved(int64_t boxedValue);
extern Promise *cs_fiber_spawn(void (*body)(void *), void *arg);
extern int64_t cs_await(Promise *p);
extern void cs_run_event_loop(void);

static int failed = 0;

static void body(void *arg) {
  (void)arg;
  // number: bitcast the double to i64, round-trip, bitcast back.
  double d = 3.14159265358979;
  int64_t nbits;
  memcpy(&nbits, &d, 8);
  int64_t gotN = cs_await(cs_promise_resolved(nbits));
  double back;
  memcpy(&back, &gotN, 8);
  if (back != d) { printf("FAIL: number %g != %g\n", back, d); failed = 1; }

  // pointer: a heap object round-trips as its address.
  void *obj = GC_malloc(16);
  int64_t gotP = cs_await(cs_promise_resolved((int64_t)(intptr_t)obj));
  if ((void *)(intptr_t)gotP != obj) { printf("FAIL: pointer mismatch\n"); failed = 1; }

  // boolean: 0/1.
  if (cs_await(cs_promise_resolved(1)) != 1) { printf("FAIL: bool true\n"); failed = 1; }
  if (cs_await(cs_promise_resolved(0)) != 0) { printf("FAIL: bool false\n"); failed = 1; }
}

int main(void) {
  GC_INIT();
  cs_fiber_spawn(body, 0);
  cs_run_event_loop();
  return failed;
}
