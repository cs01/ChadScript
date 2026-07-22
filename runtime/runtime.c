// ChadScript v2 runtime. Phase 0: just enough to print a line and exit. Grows per phase.
// ABI rule (see CLAUDE.md): JS numbers cross as `double`, never int. Strings here are still
// C cstrings (Phase 0); real JS strings become {ptr,len} in Phase 1+.

#include <stdio.h>
#include <math.h>
#include <string.h>
#include "number.h"

// console.log is variadic and space-separated (Node: `console.log(a, b)` → "a b\n"). Codegen
// emits one print per argument, a space between them, and a trailing newline. These helpers
// each write ONE piece with no separator/newline of their own.

void cs_print_cstr(const char *s) { fputs(s, stdout); }

void cs_print_f64(double x) {
  // console.log distinguishes negative zero — Node's util.inspect prints "-0" — even though
  // Number::toString (cs_num_to_str) gives "0". This -0 handling is specific to console.log;
  // String()/template coercion (which will use cs_num_to_str) must keep "0".
  if (x == 0.0 && signbit(x)) {
    fputs("-0", stdout);
    return;
  }
  char buf[40];
  cs_num_to_str(x, buf);
  fputs(buf, stdout);
}

// Boolean passed as i32 (0/1) to avoid i1 ABI ambiguity.
void cs_print_bool(int b) { fputs(b ? "true" : "false", stdout); }

void cs_print_space(void) { fputc(' ', stdout); }

void cs_print_newline(void) { fputc('\n', stdout); }

// Exception handling via setjmp/longjmp. A GC'd language needs no stack unwinding for cleanup
// (Boehm reclaims memory), so a handler stack of jmp_buf pointers is enough: `try` pushes a
// buffer + setjmps; `throw` longjmps to the top handler (unwinding the C stack across any number
// of frames), or terminates when none is set.
#include <stdlib.h>
#include <setjmp.h>
#include <gc.h>

// A thrown value. `isError` distinguishes `throw new Error(m)` (1) from `throw "s"` (0), which
// `String(e)` and `e instanceof Error` need. Only string-messaged throws are in the subset.
typedef struct {
  int isError;
  const char *message;
} CsThrown;

CsThrown *cs_new_error(const char *message) {
  CsThrown *t = GC_malloc(sizeof(CsThrown));
  t->isError = 1;
  t->message = message;
  return t;
}
CsThrown *cs_new_thrown_str(const char *s) {
  CsThrown *t = GC_malloc(sizeof(CsThrown));
  t->isError = 0;
  t->message = s;
  return t;
}
int cs_thrown_is_error(CsThrown *t) { return t->isError; }
const char *cs_thrown_message(CsThrown *t) { return t->message; }
// `String(e)`: an Error stringifies as "Error: <message>"; a thrown string as itself.
char *cs_thrown_to_string(CsThrown *t) {
  const char *m = t->message ? t->message : "";
  if (!t->isError) {
    size_t n = strlen(m);
    char *r = GC_malloc(n + 1);
    memcpy(r, m, n + 1);
    return r;
  }
  size_t n = strlen(m);
  char *r = GC_malloc(n + 8);
  memcpy(r, "Error: ", 7);
  memcpy(r + 7, m, n + 1);
  return r;
}

// A try handler: the setjmp buffer plus the value thrown to it. The thrown value lives HERE (in
// the handler), not in a global — so exception state is local to the handler chain and will be
// fiber-local once each fiber owns its own chain. `buf` is first so a CsHandler* is directly
// usable as the jmp_buf pointer for setjmp/longjmp.
typedef struct {
  jmp_buf buf;
  CsThrown *thrown;
} CsHandler;

#define CS_MAX_HANDLERS 1024
static CsHandler *cs_handlers[CS_MAX_HANDLERS];
static int cs_handler_n = 0;

// Allocate a handler for a `try` (GC-managed; codegen calls setjmp on it directly).
void *cs_handler_alloc(void) { return GC_malloc(sizeof(CsHandler)); }
void cs_push_handler(void *h) {
  if (cs_handler_n < CS_MAX_HANDLERS) cs_handlers[cs_handler_n] = h;
  cs_handler_n++;
}
void cs_pop_handler(void) {
  if (cs_handler_n > 0) cs_handler_n--;
}

// Structured-completion support: a try records the handler depth on entry, and its cleanup path
// restores to that depth on ANY exit (normal, return, throw) — so the pop count is uniform
// regardless of which exit is taken. Restore only ever pops (never pushes).
int cs_handler_count(void) { return cs_handler_n; }
void cs_handler_restore(int n) {
  if (cs_handler_n > n) cs_handler_n = n;
}

// The value thrown to a handler (read by a catch binding, and by a finally that re-raises).
CsThrown *cs_handler_thrown(void *h) { return ((CsHandler *)h)->thrown; }

// throw: unwind to the innermost handler (stashing the value IN that handler), or terminate when
// none exists (Node exits 1 on an uncaught exception; the harness compares stdout + exit code, so
// the stderr text is best-effort).
void cs_throw(CsThrown *value) {
  if (cs_handler_n > 0) {
    cs_handler_n--;
    CsHandler *h = cs_handlers[cs_handler_n];
    h->thrown = value;
    _longjmp(h->buf, 1);
  }
  if (value && value->message) fprintf(stderr, "Error: %s\n", value->message);
  else fputs("Error\n", stderr);
  exit(1);
}
