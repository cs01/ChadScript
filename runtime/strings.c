// String runtime. Strings are NUL-terminated (Phase 1); a {ptr,len} representation comes later.
// Heap allocations go through Boehm GC (GC_malloc) — reclaimed when unreachable, so string
// building in a loop no longer leaks. Boehm scans the stack/registers conservatively, so a
// string pointer held in a local (alloca/register) keeps its buffer alive.

#include <string.h>
#include <math.h>
#include <gc.h>
#include "number.h"
#include "strings.h"

char *cs_str_concat(const char *a, const char *b) {
  size_t la = strlen(a), lb = strlen(b);
  char *r = GC_malloc(la + lb + 1);
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
  char *r = GC_malloc(n + 1);
  memcpy(r, buf, n + 1);
  return r;
}

const char *cs_bool_to_string(int b) { return b ? "true" : "false"; }

// Number.prototype.toString(radix). radix 10 (and NaN/±0/±Infinity, whose spelling is radix-
// independent) use the base-10 formatter; other radices use the ported V8 algorithm.
extern char *cs_num_to_radix(double value, int radix);
char *cs_num_to_string_radix(double x, double dradix) {
  int radix = (int)dradix;
  if (radix == 10 || isnan(x) || x == 0.0 || isinf(x)) {
    return cs_num_to_string(x);
  }
  return cs_num_to_radix(x, radix);
}

// String equality (for `switch` on strings, and later `===`). 1 if equal, else 0.
int cs_str_eq(const char *a, const char *b) { return strcmp(a, b) == 0 ? 1 : 0; }
