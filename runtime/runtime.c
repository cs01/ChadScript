// ChadScript v2 runtime. Phase 0: just enough to print a line and exit. Grows per phase.
// ABI rule (see CLAUDE.md): JS numbers cross as `double`, never int. Strings here are still
// C cstrings (Phase 0); real JS strings become {ptr,len} in Phase 1+.

#include <stdio.h>
#include <math.h>
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

#define CS_MAX_HANDLERS 1024
static void *cs_handlers[CS_MAX_HANDLERS];
static const char *cs_handler_msg[CS_MAX_HANDLERS]; // thrown message, for a future catch binding
static int cs_handler_n = 0;

// Allocate a jmp_buf for a `try` (GC-managed; codegen calls setjmp on it).
void *cs_handler_alloc(void) { return GC_malloc(sizeof(jmp_buf)); }
void cs_push_handler(void *buf) {
  if (cs_handler_n < CS_MAX_HANDLERS) cs_handlers[cs_handler_n] = buf;
  cs_handler_n++;
}
void cs_pop_handler(void) {
  if (cs_handler_n > 0) cs_handler_n--;
}

// throw: unwind to the innermost handler if one exists, else terminate (Node exits 1 on an
// uncaught exception; the differential harness compares stdout + exit code, so the stderr text is
// best-effort). The message is stashed for the (future) catch binding.
void cs_throw(const char *message) {
  if (cs_handler_n > 0) {
    cs_handler_n--;
    cs_handler_msg[cs_handler_n] = message;
    _longjmp(*(jmp_buf *)cs_handlers[cs_handler_n], 1);
  }
  if (message) fprintf(stderr, "Error: %s\n", message);
  else fputs("Error\n", stderr);
  exit(1);
}
