// ChadScript v2 runtime. Phase 0: just enough to print a line and exit. Grows per phase.
// ABI rule (see CLAUDE.md): JS numbers cross as `double`, never int. Strings here are still
// C cstrings (Phase 0); real JS strings become {ptr,len} in Phase 1+.

#include <stdio.h>
#include "number.h"

// console.log of a single string argument. Node appends a newline; we match that exactly.
void cs_console_log_cstr(const char *s) {
  fputs(s, stdout);
  fputc('\n', stdout);
}

// console.log of a single number. Formatted JS-exactly (see number.c), then a newline.
void cs_console_log_f64(double x) {
  char buf[40];
  cs_num_to_str(x, buf);
  fputs(buf, stdout);
  fputc('\n', stdout);
}
