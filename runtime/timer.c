// `setTimeout` — the timers phase of the event loop. Kept out of async.c so the microtask queue
// and the timer queue stay separately readable; async.c's cs_run_event_loop drives both through
// the two entry points at the bottom of this file.
//
// Node's observable contract, which the differential fixtures pin:
//   - callbacks fire in (deadline, insertion) order, so equal delays keep registration order;
//   - a delay below 1ms (including 0, negative, and NaN) is clamped to 1ms;
//   - the microtask queue drains FULLY between two timer callbacks, not just at the end.
//
// The loop really SLEEPS until each deadline rather than firing everything immediately in sorted
// order. Sorting alone would reproduce ordering but not elapsed time, and a program that measures
// `Date.now()` across a timeout would then diverge from Node. Fixtures use small delays to keep
// this cheap.

#include <errno.h>
#include <gc.h>
#include <stdint.h>
#include <time.h>

// A closure value: the {fnptr, env} GC record codegen builds (see evalCallClosure — slot 0 is the
// function pointer, slot 1 is the environment). A zero-argument void callback is `fn(env)`.
typedef struct {
  int64_t fnptr;
  int64_t env;
} CsClosure;

typedef struct Timer {
  double deadline_ms;  // monotonic, not wall-clock: immune to clock adjustment mid-run
  uint64_t seq;        // registration order — the tiebreak for equal deadlines
  CsClosure *callback;
  struct Timer *next;
} Timer;

// Sorted singly-linked list, earliest first. Linear insert is O(n) per timer, which is the right
// tradeoff at the scale the subset targets (the same call the review made for Map/Set); a heap
// lands if a profile ever justifies it.
static Timer *cs_timers = NULL;
static uint64_t cs_timer_seq = 0;

static double now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1.0e6;
}

void cs_set_timeout(CsClosure *callback, double delay_ms) {
  // `!(delay >= 1)` rather than `delay < 1` so NaN clamps too — NaN compares false with
  // everything, and Node treats a NaN delay as 1ms.
  if (!(delay_ms >= 1.0)) delay_ms = 1.0;

  Timer *t = GC_malloc(sizeof(Timer));
  t->deadline_ms = now_ms() + delay_ms;
  t->seq = cs_timer_seq++;
  t->callback = callback;
  t->next = NULL;

  Timer **link = &cs_timers;
  while (*link != NULL && ((*link)->deadline_ms < t->deadline_ms ||
                           ((*link)->deadline_ms == t->deadline_ms && (*link)->seq < t->seq))) {
    link = &(*link)->next;
  }
  t->next = *link;
  *link = t;
}

int cs_timers_pending(void) { return cs_timers != NULL; }

// Sleep until the earliest timer is due, then run exactly ONE callback. The caller drains
// microtasks between calls, which is what makes the interleaving match Node.
void cs_timers_run_earliest(void) {
  Timer *t = cs_timers;
  if (t == NULL) return;
  cs_timers = t->next;

  double remaining = t->deadline_ms - now_ms();
  if (remaining > 0) {
    struct timespec req;
    req.tv_sec = (time_t)(remaining / 1000.0);
    req.tv_nsec = (long)((remaining - (double)req.tv_sec * 1000.0) * 1.0e6);
    // Restart on EINTR so a signal cannot make a timer fire early. Any other error means the
    // remaining time is unrepresentable, and looping on it would hang — fire instead.
    while (nanosleep(&req, &req) == -1 && errno == EINTR) {
    }
  }

  void (*fn)(void *) = (void (*)(void *))(intptr_t)t->callback->fnptr;
  fn((void *)(intptr_t)t->callback->env);
}
