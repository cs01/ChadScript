// ChadScript v2 runtime. Phase 0: just enough to print a line and exit. Grows per phase.
// ABI rule (see CLAUDE.md): JS numbers cross as `double`, never int. Strings here are still
// C cstrings (Phase 0); real JS strings become {ptr,len} in Phase 1+.

#include <stdio.h>
#include "number.h"

// console.log is variadic and space-separated (Node: `console.log(a, b)` → "a b\n"). Codegen
// emits one print per argument, a space between them, and a trailing newline. These helpers
// each write ONE piece with no separator/newline of their own.

void cs_print_cstr(const char *s) { fputs(s, stdout); }

void cs_print_f64(double x) {
  char buf[40];
  cs_num_to_str(x, buf);
  fputs(buf, stdout);
}

// Boolean passed as i32 (0/1) to avoid i1 ABI ambiguity.
void cs_print_bool(int b) { fputs(b ? "true" : "false", stdout); }

void cs_print_space(void) { fputc(' ', stdout); }

void cs_print_newline(void) { fputc('\n', stdout); }
