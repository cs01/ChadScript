// String runtime. Strings are NUL-terminated (Phase 1); a {ptr,len} representation comes later.
// Heap allocations go through Boehm GC (GC_malloc) — reclaimed when unreachable, so string
// building in a loop no longer leaks. Boehm scans the stack/registers conservatively, so a
// string pointer held in a local (alloca/register) keeps its buffer alive.

#include <string.h>
#include <stdlib.h>
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

static int str_is_ws(unsigned char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

// Parse a whole string as a radix integer (Number("0x1f") etc.); NaN if empty or any bad digit.
static double parse_radix_whole(const char *s, int radix) {
  if (!*s) return (double)NAN;
  double v = 0;
  for (; *s; s++) {
    int d;
    char c = *s;
    if (c >= '0' && c <= '9') d = c - '0';
    else if (c >= 'a' && c <= 'z') d = c - 'a' + 10;
    else if (c >= 'A' && c <= 'Z') d = c - 'A' + 10;
    else return (double)NAN;
    if (d >= radix) return (double)NAN;
    v = v * radix + d;
  }
  return v;
}

// ECMAScript StringToNumber (what `Number(str)` uses): the WHOLE trimmed string must be a valid
// numeric literal, else NaN. Empty/whitespace → 0. Supports 0x/0o/0b (unsigned), Infinity, and
// decimal with exponent. Stricter than parseFloat (which takes a leading prefix).
double cs_string_to_number(const char *s0) {
  const char *s = s0;
  while (str_is_ws((unsigned char)*s)) s++;
  const char *end = s + strlen(s);
  while (end > s && str_is_ws((unsigned char)end[-1])) end--;
  size_t len = (size_t)(end - s);
  if (len == 0) return 0.0;
  char buf[600];
  if (len >= sizeof buf) return (double)NAN;
  memcpy(buf, s, len);
  buf[len] = '\0';

  // Non-decimal integer literals (no sign permitted).
  if (buf[0] == '0' && (buf[1] == 'x' || buf[1] == 'X')) return parse_radix_whole(buf + 2, 16);
  if (buf[0] == '0' && (buf[1] == 'o' || buf[1] == 'O')) return parse_radix_whole(buf + 2, 8);
  if (buf[0] == '0' && (buf[1] == 'b' || buf[1] == 'B')) return parse_radix_whole(buf + 2, 2);

  const char *p = buf;
  int sign = 1;
  if (*p == '+') p++;
  else if (*p == '-') { sign = -1; p++; }
  if (strcmp(p, "Infinity") == 0) return sign * (double)INFINITY;

  // Decimal: only [0-9.eE+-] permitted, so strtod can't sneak in "inf"/"nan"/hex-float spellings.
  for (const char *c = buf; *c; c++) {
    char ch = *c;
    if (!((ch >= '0' && ch <= '9') || ch == '.' || ch == 'e' || ch == 'E' || ch == '+' ||
          ch == '-')) {
      return (double)NAN;
    }
  }
  char *pe;
  double v = strtod(buf, &pe);
  if (pe != buf + len) return (double)NAN; // trailing garbage → not a complete literal
  return v;
}

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
