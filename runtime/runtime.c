// ChadScript v2 runtime. Phase 0: just enough to print a line and exit. Grows per phase.
// ABI rule (see CLAUDE.md): JS numbers cross as `double`, never int. Strings here are still
// C cstrings (Phase 0); real JS strings become {ptr,len} in Phase 1+.

#include <stdio.h>

// console.log of a single string argument. Node appends a newline; we match that exactly.
void cs_console_log_cstr(const char *s) {
  fputs(s, stdout);
  fputc('\n', stdout);
}
