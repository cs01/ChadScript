// String runtime. Strings are NUL-terminated (Phase 1); a {ptr,len} representation and a real
// GC come later. Allocations here currently leak (malloc, no free) — correct output, but not
// production memory behavior. Wiring Boehm GC is a tracked follow-up.

#include <stdlib.h>
#include <string.h>
#include "number.h"
#include "strings.h"

char *cs_str_concat(const char *a, const char *b) {
  size_t la = strlen(a), lb = strlen(b);
  char *r = malloc(la + lb + 1);
  memcpy(r, a, la);
  memcpy(r + la, b, lb);
  r[la + lb] = '\0';
  return r;
}

// Number → string via Number::toString semantics (cs_num_to_str). Note: this is the string
// COERCION path (`"" + x`, template literals), so -0 becomes "0" — unlike console.log(-0).
char *cs_num_to_string(double x) {
  char buf[40];
  cs_num_to_str(x, buf);
  size_t n = strlen(buf);
  char *r = malloc(n + 1);
  memcpy(r, buf, n + 1);
  return r;
}

const char *cs_bool_to_string(int b) { return b ? "true" : "false"; }

// String equality (for `switch` on strings, and later `===`). 1 if equal, else 0.
int cs_str_eq(const char *a, const char *b) { return strcmp(a, b) == 0 ? 1 : 0; }
