// String runtime: concatenation, to-string coercions, inspect formatting, and Number(str) parsing.
// Strings are {data,len} (see strings.h) — NUL is an ordinary byte. Heap goes through Boehm GC.

#include <string.h>
#include <stdlib.h>
#include <math.h>
#include <gc.h>
#include "number.h"
#include "strings.h"

CsString *cs_str_concat(const CsString *a, const CsString *b) {
  size_t la = a->len, lb = b->len, n = la + lb;
  char *r = GC_malloc(n ? n : 1);
  memcpy(r, a->data, la);
  memcpy(r + la, b->data, lb);
  return cs_str_mk(r, n);
}

// Number → string via Number::toString semantics (cs_num_to_str). This is the string COERCION
// path (`"" + x`, template literals), so -0 becomes "0" — unlike console.log(-0). Numeric output
// is pure ASCII, so strlen on the formatter buffer is safe here.
CsString *cs_num_to_string(double x) {
  char buf[40];
  cs_num_to_str(x, buf);
  return cs_str_from(buf, strlen(buf));
}

CsString *cs_bool_to_string(int b) {
  static const CsString t = {"true", 4}, f = {"false", 5};
  return (CsString *)(b ? &t : &f);
}

// util.inspect number: like Number::toString, except -0 prints as "-0" (Node shows the sign in
// inspect output, unlike String(-0)).
CsString *cs_inspect_num(double x) {
  if (x == 0.0 && signbit(x)) return cs_str_mk("-0", 2);
  return cs_num_to_string(x);
}

// util.inspect string: quoted. Node prefers single quotes; if the string has a single quote but
// no double quote it uses double quotes; otherwise single quotes with `'` escaped. Backslash and
// control chars are escaped exactly as Node does: \b \t \n \f \r are named, every other byte
// below 0x20 (NUL included) becomes \xHH with UPPERCASE hex.
CsString *cs_inspect_str(const CsString *s) {
  const char *d = s->data;
  size_t n = s->len;
  int has_single = 0, has_double = 0;
  for (size_t i = 0; i < n; i++) {
    if (d[i] == '\'') has_single = 1;
    else if (d[i] == '"') has_double = 1;
  }
  char quote = (has_single && !has_double) ? '"' : '\'';
  // Worst case every byte becomes \xHH (4 bytes), plus the two quotes.
  char *r = GC_malloc(n * 4 + 2);
  size_t o = 0;
  r[o++] = quote;
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)d[i];
    char named = 0;
    if (c == (unsigned char)quote || c == '\\') { r[o++] = '\\'; r[o++] = (char)c; continue; }
    else if (c == '\b') named = 'b';
    else if (c == '\t') named = 't';
    else if (c == '\n') named = 'n';
    else if (c == '\f') named = 'f';
    else if (c == '\r') named = 'r';
    if (named) {
      r[o++] = '\\';
      r[o++] = named;
    } else if (c < 0x20) {
      static const char hex[] = "0123456789ABCDEF";
      r[o++] = '\\';
      r[o++] = 'x';
      r[o++] = hex[c >> 4];
      r[o++] = hex[c & 0xf];
    } else {
      r[o++] = (char)c;
    }
  }
  r[o++] = quote;
  return cs_str_mk(r, o);
}

static int str_is_ws(unsigned char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

// Parse a whole NUL-terminated buffer as a radix integer (Number("0x1f") etc.); NaN if empty or
// any bad digit. Operates on a private copy that the caller has already NUL-terminated.
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
// decimal with exponent. An embedded NUL is not a valid numeric char, so such a string → NaN
// (matching Node: `Number("1\x000")` is NaN). We trim on `len`, copy into a NUL-terminated buffer.
double cs_string_to_number(const CsString *str) {
  const char *base = str->data;
  size_t total = str->len;
  size_t start = 0, end = total;
  while (start < end && str_is_ws((unsigned char)base[start])) start++;
  while (end > start && str_is_ws((unsigned char)base[end - 1])) end--;
  size_t len = end - start;
  if (len == 0) return 0.0;
  char buf[600];
  if (len >= sizeof buf) return (double)NAN;
  memcpy(buf, base + start, len);
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

  // Decimal: only [0-9.eE+-] permitted (so an embedded NUL, "inf", "nan", hex-floats all reject).
  for (size_t i = 0; i < len; i++) {
    char ch = buf[i];
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
// independent) use the base-10 formatter; other radices use the ported V8 algorithm (ASCII out).
extern char *cs_num_to_radix(double value, int radix);
CsString *cs_num_to_string_radix(double x, double dradix) {
  int radix = (int)dradix;
  if (radix == 10 || isnan(x) || x == 0.0 || isinf(x)) {
    return cs_num_to_string(x);
  }
  char *r = cs_num_to_radix(x, radix);
  return cs_str_from(r, strlen(r));
}

// String equality (for `switch` on strings, and `===`). Length-then-bytes, so embedded NUL is
// compared, not treated as a terminator. 1 if equal, else 0.
int cs_str_eq(const CsString *a, const CsString *b) {
  if (a->len != b->len) return 0;
  return memcmp(a->data, b->data, a->len) == 0 ? 1 : 0;
}
