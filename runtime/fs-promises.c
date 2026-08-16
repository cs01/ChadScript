// `node:fs/promises` — the async mirror of the node:fs surface in fs.c.
//
// The syscall runs SYNCHRONOUSLY at call time; only the promise's SETTLEMENT is deferred, onto an
// I/O completion queue the event loop drains after the timers phase. Blocking is not observable in
// program output — only ordering is — and this keeps the phase model honest: microtasks, then due
// timers, then I/O completions, which is the order Node's loop delivers them in.
//
// Errors become REJECTIONS rather than synchronous throws, as in Node. Rather than duplicate fs.c's
// syscalls in a non-throwing form, each call runs under the runtime's own handler so an fs.c throw
// is captured and handed to cs_promise_reject.

#include "strings.h"
#include <gc.h>
#include <stdint.h>

typedef struct Promise Promise;
extern Promise *cs_promise_new(void);
extern void cs_promise_resolve(Promise *p, int64_t boxedValue);
extern void cs_promise_reject(Promise *p, void *reason);

extern void *cs_handler_alloc(void);
extern void cs_push_handler(void *h);
extern void cs_pop_handler(void);
extern void *cs_handler_thrown(void *h);
extern int _setjmp(void *buf);

// The throwing sync implementations, reused as-is.
extern CsString *cs_fs_read_file(const CsString *path);
extern void cs_fs_write_file(const CsString *path, const CsString *data);
extern void cs_fs_append_file(const CsString *path, const CsString *data);
extern void cs_fs_unlink(const CsString *path);

// One deferred settlement. Kept in FIFO order: two reads issued back to back settle in the order
// they were issued, which is what makes a fixture's output deterministic.
typedef struct Completion {
  Promise *promise;
  int rejected;
  int64_t value;   // fulfilled: the boxed result (0 for void)
  void *reason;    // rejected: the CsThrown*
  struct Completion *next;
} Completion;

static Completion *cs_io_head = NULL;
static Completion *cs_io_tail = NULL;

static void enqueue(Promise *p, int rejected, int64_t value, void *reason) {
  Completion *c = GC_malloc(sizeof(Completion));
  c->promise = p;
  c->rejected = rejected;
  c->value = value;
  c->reason = reason;
  c->next = NULL;
  if (cs_io_tail) cs_io_tail->next = c;
  else cs_io_head = c;
  cs_io_tail = c;
}

int cs_io_pending(void) { return cs_io_head != NULL; }

// Settle exactly one completion. The caller drains microtasks afterwards, so an awaiting fiber
// resumes before the next completion is delivered.
void cs_io_settle_one(void) {
  Completion *c = cs_io_head;
  if (!c) return;
  cs_io_head = c->next;
  if (!cs_io_head) cs_io_tail = NULL;
  if (c->rejected) cs_promise_reject(c->promise, c->reason);
  else cs_promise_resolve(c->promise, c->value);
}

// Run `op` under a handler; enqueue its result (or the value it threw) as a completion.
// `out` receives the boxed fulfilled value when the operation returns normally.
#define RUN_GUARDED(p, stmt, boxed)                     \
  do {                                                  \
    void *h = cs_handler_alloc();                       \
    cs_push_handler(h);                                 \
    if (_setjmp(h) == 0) {                              \
      stmt;                                             \
      cs_pop_handler();                                 \
      enqueue((p), 0, (boxed), NULL);                   \
    } else {                                            \
      enqueue((p), 1, 0, cs_handler_thrown(h));         \
    }                                                   \
  } while (0)

Promise *cs_fsp_read_file(const CsString *path) {
  Promise *p = cs_promise_new();
  CsString *body = NULL;
  RUN_GUARDED(p, body = cs_fs_read_file(path), (int64_t)(intptr_t)body);
  return p;
}

Promise *cs_fsp_write_file(const CsString *path, const CsString *data) {
  Promise *p = cs_promise_new();
  RUN_GUARDED(p, cs_fs_write_file(path, data), 0);
  return p;
}

Promise *cs_fsp_append_file(const CsString *path, const CsString *data) {
  Promise *p = cs_promise_new();
  RUN_GUARDED(p, cs_fs_append_file(path, data), 0);
  return p;
}

Promise *cs_fsp_unlink(const CsString *path) {
  Promise *p = cs_promise_new();
  RUN_GUARDED(p, cs_fs_unlink(path), 0);
  return p;
}
