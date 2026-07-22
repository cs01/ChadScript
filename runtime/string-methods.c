// String method runtime. Strings are {data,len} (see strings.h) — every scan is length-bounded
// and NUL-safe (cs_mem_find, memcmp), never strlen/strstr. New strings are GC-allocated.
// Semantics are JS-exact for ASCII (per the UTF-8 decision); the fuzzer stays ASCII-only.

#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>
#include <gc.h>
#include "strings.h"

int cs_str_len(const CsString *s) { return (int)s->len; }

static CsString *empty(void) { return cs_str_mk("", 0); }

// Copy the byte range [a, b) of `s` into a fresh string.
static CsString *substr(const CsString *s, size_t a, size_t b) {
  return cs_str_from(s->data + a, b - a);
}

static CsString *dup_upper_lower(const CsString *s, int upper) {
  size_t n = s->len;
  char *r = GC_malloc(n ? n : 1);
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s->data[i];
    r[i] = (char)(upper ? toupper(c) : tolower(c));
  }
  return cs_str_mk(r, n);
}
CsString *cs_str_upper(const CsString *s) { return dup_upper_lower(s, 1); }
CsString *cs_str_lower(const CsString *s) { return dup_upper_lower(s, 0); }

static int is_ws(unsigned char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

// JS trim: strips leading/trailing ASCII whitespace.
CsString *cs_str_trim(const CsString *s) {
  size_t n = s->len, a = 0, b = n;
  while (a < b && is_ws((unsigned char)s->data[a])) a++;
  while (b > a && is_ws((unsigned char)s->data[b - 1])) b--;
  return substr(s, a, b);
}

// JS repeat: `count` copies. Fractional counts truncate; negative is a RangeError in JS, but we
// don't throw yet — clamp to 0 (documented divergence, rare).
CsString *cs_str_repeat(const CsString *s, double count) {
  long c = (long)count;
  if (c < 0) c = 0;
  size_t n = s->len, total = n * (size_t)c;
  char *r = GC_malloc(total ? total : 1);
  for (long i = 0; i < c; i++) memcpy(r + (size_t)i * n, s->data, n);
  return cs_str_mk(r, total);
}

// JS includes(sub, position): search begins at position, clamped to [0, len].
int cs_str_includes(const CsString *s, const CsString *sub, double dpos) {
  long from = (long)dpos;
  if (from < 0) from = 0;
  if ((size_t)from > s->len) from = (long)s->len;
  return cs_mem_find(s->data, s->len, sub->data, sub->len, (size_t)from) >= 0 ? 1 : 0;
}

// Ordered comparison for the default array sort (lexicographic by byte, ASCII-exact). Sign only.
int cs_str_cmp(const CsString *a, const CsString *b) {
  size_t n = a->len < b->len ? a->len : b->len;
  int c = memcmp(a->data, b->data, n);
  if (c != 0) return c;
  if (a->len < b->len) return -1;
  if (a->len > b->len) return 1;
  return 0;
}

// JS indexOf(sub, fromIndex): search begins at fromIndex, clamped to [0, len]. A negative or NaN
// fromIndex clamps to 0; one past the end returns -1 (or `len` for an empty needle, per mem_find).
double cs_str_index_of(const CsString *s, const CsString *sub, double dfrom) {
  long from = (long)dfrom;
  if (from < 0) from = 0;
  if ((size_t)from > s->len) from = (long)s->len;
  return (double)cs_mem_find(s->data, s->len, sub->data, sub->len, (size_t)from);
}

// JS startsWith(p, position): does p occur at `position` (clamped [0,len])? Empty p always matches.
int cs_str_starts_with(const CsString *s, const CsString *p, double dpos) {
  long pos = (long)dpos;
  if (pos < 0) pos = 0;
  if ((size_t)pos > s->len) return p->len == 0 ? 1 : 0;
  if (p->len > s->len - (size_t)pos) return 0;
  return memcmp(s->data + pos, p->data, p->len) == 0 ? 1 : 0;
}

// JS endsWith(p, endPosition): treat the string as if it ended at endPosition (clamped [0,len]; a
// NaN sentinel from codegen means "use the full length" — the default). Does p end there?
int cs_str_ends_with(const CsString *s, const CsString *p, double dend) {
  size_t endpos;
  if (isnan(dend)) {
    endpos = s->len;
  } else {
    long e = (long)dend;
    if (e < 0) e = 0;
    endpos = (size_t)e > s->len ? s->len : (size_t)e;
  }
  if (p->len > endpos) return 0;
  return memcmp(s->data + endpos - p->len, p->data, p->len) == 0 ? 1 : 0;
}

extern char cs_undefined_marker; // the `undefined` sentinel (see nullable.c)

// `str.at(i)` → `string | undefined`: the 1-char string at i (negative counts from the end), or
// undefined when out of range. Returns the optional pointer directly (box of the string ptr, or
// the sentinel), matching the nullable representation.
void *cs_str_at(const CsString *s, double di) {
  long n = (long)s->len;
  long i = (long)di;
  if (i < 0) i += n;
  if (i < 0 || i >= n) return &cs_undefined_marker;
  CsString *c = cs_str_from(s->data + i, 1);
  long *box = GC_malloc(sizeof(long));
  *box = (long)(intptr_t)c;
  return box;
}

// JS charAt: the 1-char string at i, or "" if out of range.
CsString *cs_str_char_at(const CsString *s, double di) {
  long n = (long)s->len;
  long i = (long)di;
  if (i < 0 || i >= n) return empty();
  return substr(s, (size_t)i, (size_t)i + 1);
}

// JS slice with negative-index resolution against the length.
static CsString *slice_norm(const CsString *s, long start, long end) {
  long n = (long)s->len;
  if (start < 0) start = start + n < 0 ? 0 : start + n;
  if (start > n) start = n;
  if (end < 0) end = end + n < 0 ? 0 : end + n;
  if (end > n) end = n;
  if (start >= end) return empty();
  return substr(s, (size_t)start, (size_t)end);
}
CsString *cs_str_slice1(const CsString *s, double start) {
  return slice_norm(s, (long)start, (long)s->len);
}
CsString *cs_str_slice2(const CsString *s, double start, double end) {
  return slice_norm(s, (long)start, (long)end);
}

// JS replace(a, b): replaces the FIRST occurrence of substring `a` with `b`. (String pattern
// only — regex is a later feature.)
CsString *cs_str_replace(const CsString *s, const CsString *a, const CsString *b) {
  long hit = cs_mem_find(s->data, s->len, a->data, a->len, 0);
  if (hit < 0) return substr(s, 0, s->len);
  size_t pre = (size_t)hit, la = a->len, lb = b->len;
  size_t rest = s->len - pre - la;
  char *r = GC_malloc(pre + lb + rest ? pre + lb + rest : 1);
  memcpy(r, s->data, pre);
  memcpy(r + pre, b->data, lb);
  memcpy(r + pre + lb, s->data + pre + la, rest);
  return cs_str_mk(r, pre + lb + rest);
}

// JS replaceAll(a, b): replaces EVERY occurrence of `a` with `b`. An empty pattern splices `b`
// around every character (and both ends), matching V8: "abc".replaceAll("","-") === "-a-b-c-".
CsString *cs_str_replaceAll(const CsString *s, const CsString *a, const CsString *b) {
  size_t ls = s->len, la = a->len, lb = b->len;
  if (la == 0) {
    size_t total = lb * (ls + 1) + ls;
    char *r = GC_malloc(total ? total : 1);
    size_t o = 0;
    for (size_t i = 0; i < ls; i++) {
      memcpy(r + o, b->data, lb);
      o += lb;
      r[o++] = s->data[i];
    }
    memcpy(r + o, b->data, lb);
    o += lb;
    return cs_str_mk(r, o);
  }
  // Count occurrences to size the result exactly.
  size_t count = 0;
  for (long p = 0; (p = cs_mem_find(s->data, ls, a->data, la, (size_t)p)) >= 0; p += (long)la)
    count++;
  size_t total = ls + count * (lb > la ? lb - la : 0);
  char *r = GC_malloc(total ? total : 1);
  size_t o = 0, start = 0;
  long hit;
  while ((hit = cs_mem_find(s->data, ls, a->data, la, start)) >= 0) {
    size_t pre = (size_t)hit - start;
    memcpy(r + o, s->data + start, pre);
    o += pre;
    memcpy(r + o, b->data, lb);
    o += lb;
    start = (size_t)hit + la;
  }
  size_t rest = ls - start;
  memcpy(r + o, s->data + start, rest);
  o += rest;
  return cs_str_mk(r, o);
}

// JS substring(a, b): like slice but negatives/NaN clamp to 0 and the two indices swap if a > b.
static CsString *substring_norm(const CsString *s, long start, long end) {
  long n = (long)s->len;
  if (start < 0) start = 0;
  if (end < 0) end = 0;
  if (start > n) start = n;
  if (end > n) end = n;
  if (start > end) {
    long t = start;
    start = end;
    end = t;
  }
  return substr(s, (size_t)start, (size_t)end);
}
CsString *cs_str_substring1(const CsString *s, double start) {
  return substring_norm(s, (long)start, (long)s->len);
}
CsString *cs_str_substring2(const CsString *s, double start, double end) {
  return substring_norm(s, (long)start, (long)end);
}

CsString *cs_str_trim_start(const CsString *s) {
  size_t a = 0, n = s->len;
  while (a < n && is_ws((unsigned char)s->data[a])) a++;
  return substr(s, a, n);
}
CsString *cs_str_trim_end(const CsString *s) {
  size_t n = s->len, b = n;
  while (b > 0 && is_ws((unsigned char)s->data[b - 1])) b--;
  return substr(s, 0, b);
}

// JS padStart/padEnd: pad `s` with copies of `pad` (truncated to fit) until it reaches `target`
// length. If already long enough, or `pad` is empty, returns `s` unchanged.
static CsString *pad(const CsString *s, double dtarget, const CsString *padstr, int at_start) {
  size_t n = s->len, lp = padstr->len;
  long target = (long)dtarget;
  if (target < 0 || (size_t)target <= n || lp == 0) return substr(s, 0, n);
  size_t fill = (size_t)target - n;
  char *r = GC_malloc((size_t)target);
  char *dst = at_start ? r : r + n; // where the pad block goes
  for (size_t i = 0; i < fill; i++) dst[i] = padstr->data[i % lp];
  memcpy(at_start ? r + fill : r, s->data, n);
  return cs_str_mk(r, (size_t)target);
}
CsString *cs_str_pad_start(const CsString *s, double target, const CsString *padstr) {
  return pad(s, target, padstr, 1);
}
CsString *cs_str_pad_end(const CsString *s, double target, const CsString *padstr) {
  return pad(s, target, padstr, 0);
}

// A NUL-terminated private copy, so the pointer-walking numeric parsers below can keep their exact
// spec logic. An embedded NUL then correctly reads as a parse stopper (JS parseInt/parseFloat both
// halt at the first non-numeric byte, which NUL is).
static const char *nulterm(const CsString *s) {
  char *b = GC_malloc(s->len + 1);
  memcpy(b, s->data, s->len);
  b[s->len] = '\0';
  return b;
}

// ECMAScript parseInt(str, radix). Faithful to the spec: skip leading whitespace, optional sign,
// `0x` prefix for radix 16, parse digits valid in the radix, stop at the first invalid char; no
// valid digits → NaN. `dradix` of 0 means the argument was omitted (default 10, with 0x auto-
// detect). Digits beyond '9' use letters a–z (case-insensitive), value 10–35.
double cs_parse_int(const CsString *str, double dradix) {
  const char *s = nulterm(str);
  while (is_ws((unsigned char)*s)) s++;
  int sign = 1;
  if (*s == '+') s++;
  else if (*s == '-') { sign = -1; s++; }

  int radix = (int)dradix;
  int omitted = (dradix == 0.0);
  if (omitted) radix = 10;
  if (!omitted && (radix < 2 || radix > 36)) return NAN;

  // 0x prefix: consumed when radix is 16, or when the radix was omitted (then it forces 16).
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X') && (radix == 16 || omitted)) {
    radix = 16;
    s += 2;
  }

  double result = 0.0;
  int any = 0;
  for (; *s; s++) {
    char c = *s;
    int d;
    if (c >= '0' && c <= '9') d = c - '0';
    else if (c >= 'a' && c <= 'z') d = c - 'a' + 10;
    else if (c >= 'A' && c <= 'Z') d = c - 'A' + 10;
    else break;
    if (d >= radix) break;
    result = result * radix + d;
    any = 1;
  }
  if (!any) return NAN;
  return sign * result;
}

// ECMAScript parseFloat(str). Skip leading whitespace + sign; accept the literal "Infinity";
// otherwise the token must start with a digit or '.', which rejects "inf"/"nan"/identifiers that
// strtod would otherwise consume. A leading "0x" parses only the "0" (JS stops at 'x').
double cs_parse_float(const CsString *str) {
  const char *s = nulterm(str);
  while (is_ws((unsigned char)*s)) s++;
  const char *p = s;
  int sign = 1;
  if (*p == '+') p++;
  else if (*p == '-') { sign = -1; p++; }
  if (strncmp(p, "Infinity", 8) == 0) return sign * INFINITY;
  if (!((*p >= '0' && *p <= '9') || *p == '.')) return NAN;
  if (*p == '0' && (p[1] == 'x' || p[1] == 'X')) return sign * 0.0;
  char *end;
  double v = strtod(s, &end);
  if (end == s) return NAN;
  return v;
}

// The array runtime, for split's result.
extern void *cs_array_new(void);
extern int cs_array_push(void *a, long slot);

// JS split(sep): array of substrings. Empty sep → one element per character.
void *cs_str_split(const CsString *s, const CsString *sep) {
  void *arr = cs_array_new();
  size_t ls = s->len, lsep = sep->len;
  if (lsep == 0) {
    for (size_t i = 0; i < ls; i++) cs_array_push(arr, (long)(intptr_t)substr(s, i, i + 1));
    return arr;
  }
  size_t start = 0;
  long hit;
  while ((hit = cs_mem_find(s->data, ls, sep->data, lsep, start)) >= 0) {
    cs_array_push(arr, (long)(intptr_t)substr(s, start, (size_t)hit));
    start = (size_t)hit + lsep;
  }
  cs_array_push(arr, (long)(intptr_t)substr(s, start, ls));
  return arr;
}
