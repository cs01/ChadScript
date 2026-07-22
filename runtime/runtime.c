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

// Uncaught throw (interim, pre-unwinding): write a best-effort message to stderr and terminate
// with a non-zero exit (Node exits 1 on an uncaught exception). The differential harness compares
// stdout + exit code, so this matches Node's observable behavior — the stderr text is best-effort.
#include <stdlib.h>
void cs_throw(const char *message) {
  if (message) fprintf(stderr, "Error: %s\n", message);
  else fputs("Error\n", stderr);
  exit(1);
}
