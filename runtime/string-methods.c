// String method runtime. Strings are NUL-terminated cstrings (Phase 1); results that are new
// strings are GC-allocated. Semantics are JS-exact for ASCII (per the UTF-8 decision); the
// fuzzer stays ASCII-only.

#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>
#include <gc.h>

int cs_str_len(const char *s) { return (int)strlen(s); }

static char *dup_upper_lower(const char *s, int upper) {
  size_t n = strlen(s);
  char *r = GC_malloc(n + 1);
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s[i];
    r[i] = (char)(upper ? toupper(c) : tolower(c));
  }
  r[n] = '\0';
  return r;
}
char *cs_str_upper(const char *s) { return dup_upper_lower(s, 1); }
char *cs_str_lower(const char *s) { return dup_upper_lower(s, 0); }

static int is_ws(unsigned char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

// JS trim: strips leading/trailing ASCII whitespace.
char *cs_str_trim(const char *s) {
  size_t n = strlen(s);
  size_t a = 0, b = n;
  while (a < b && is_ws((unsigned char)s[a])) a++;
  while (b > a && is_ws((unsigned char)s[b - 1])) b--;
  size_t len = b - a;
  char *r = GC_malloc(len + 1);
  memcpy(r, s + a, len);
  r[len] = '\0';
  return r;
}

// JS repeat: `count` copies. Fractional counts truncate; negative is a RangeError in JS, but we
// don't throw yet — clamp to 0 (documented divergence, rare).
char *cs_str_repeat(const char *s, double count) {
  long c = (long)count;
  if (c < 0) c = 0;
  size_t n = strlen(s);
  size_t total = n * (size_t)c;
  char *r = GC_malloc(total + 1);
  for (long i = 0; i < c; i++) memcpy(r + (size_t)i * n, s, n);
  r[total] = '\0';
  return r;
}

int cs_str_includes(const char *s, const char *sub) { return strstr(s, sub) != NULL ? 1 : 0; }

// Ordered comparison for the default array sort (lexicographic by byte, ASCII-exact). Sign only.
int cs_str_cmp(const char *a, const char *b) { return strcmp(a, b); }

double cs_str_index_of(const char *s, const char *sub) {
  const char *hit = strstr(s, sub);
  return hit == NULL ? -1.0 : (double)(hit - s);
}

int cs_str_starts_with(const char *s, const char *p) {
  size_t lp = strlen(p);
  return strncmp(s, p, lp) == 0 ? 1 : 0;
}

int cs_str_ends_with(const char *s, const char *p) {
  size_t ls = strlen(s), lp = strlen(p);
  return lp <= ls && strcmp(s + ls - lp, p) == 0 ? 1 : 0;
}

static char *substr(const char *s, size_t a, size_t b) {
  size_t len = b - a;
  char *r = GC_malloc(len + 1);
  memcpy(r, s + a, len);
  r[len] = '\0';
  return r;
}

// JS charAt: the 1-char string at i, or "" if out of range.
char *cs_str_char_at(const char *s, double di) {
  long n = (long)strlen(s);
  long i = (long)di;
  if (i < 0 || i >= n) return substr("", 0, 0);
  return substr(s, (size_t)i, (size_t)i + 1);
}

// JS slice with a resolved [start, end) already normalized to indices. Negative indices are
// handled by the two entry points below (they know whether `end` was supplied).
static char *slice_norm(const char *s, long start, long end) {
  long n = (long)strlen(s);
  if (start < 0) start = start + n < 0 ? 0 : start + n;
  if (start > n) start = n;
  if (end < 0) end = end + n < 0 ? 0 : end + n;
  if (end > n) end = n;
  if (start >= end) return substr("", 0, 0);
  return substr(s, (size_t)start, (size_t)end);
}
char *cs_str_slice1(const char *s, double start) {
  return slice_norm(s, (long)start, (long)strlen(s));
}
char *cs_str_slice2(const char *s, double start, double end) {
  return slice_norm(s, (long)start, (long)end);
}

// JS replace(a, b): replaces the FIRST occurrence of substring `a` with `b`. (First pass: string
// pattern only — regex is a later feature.)
char *cs_str_replace(const char *s, const char *a, const char *b) {
  const char *hit = strstr(s, a);
  if (!hit) return substr(s, 0, strlen(s));
  size_t pre = (size_t)(hit - s), la = strlen(a), lb = strlen(b), lrest = strlen(hit + la);
  char *r = GC_malloc(pre + lb + lrest + 1);
  memcpy(r, s, pre);
  memcpy(r + pre, b, lb);
  memcpy(r + pre + lb, hit + la, lrest + 1); // includes NUL
  return r;
}

// JS replaceAll(a, b): replaces EVERY occurrence of `a` with `b`. An empty pattern splices `b`
// around every character (and both ends), matching V8: "abc".replaceAll("","-") === "-a-b-c-".
char *cs_str_replaceAll(const char *s, const char *a, const char *b) {
  size_t ls = strlen(s), la = strlen(a), lb = strlen(b);
  if (la == 0) {
    char *r = GC_malloc(lb * (ls + 1) + ls + 1);
    size_t o = 0;
    for (size_t i = 0; i < ls; i++) {
      memcpy(r + o, b, lb);
      o += lb;
      r[o++] = s[i];
    }
    memcpy(r + o, b, lb);
    o += lb;
    r[o] = '\0';
    return r;
  }
  // Count occurrences to size the result exactly.
  size_t count = 0;
  for (const char *p = s; (p = strstr(p, a)) != NULL; p += la) count++;
  char *r = GC_malloc(ls + count * (lb > la ? lb - la : 0) + 1);
  size_t o = 0, start = 0;
  const char *hit;
  while ((hit = strstr(s + start, a)) != NULL) {
    size_t pre = (size_t)(hit - (s + start));
    memcpy(r + o, s + start, pre);
    o += pre;
    memcpy(r + o, b, lb);
    o += lb;
    start += pre + la;
  }
  size_t rest = ls - start;
  memcpy(r + o, s + start, rest + 1); // includes NUL
  return r;
}

// JS substring(a, b): like slice but negatives/NaN clamp to 0 and the two indices swap if a > b.
static char *substring_norm(const char *s, long start, long end) {
  long n = (long)strlen(s);
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
char *cs_str_substring1(const char *s, double start) {
  return substring_norm(s, (long)start, (long)strlen(s));
}
char *cs_str_substring2(const char *s, double start, double end) {
  return substring_norm(s, (long)start, (long)end);
}

char *cs_str_trim_start(const char *s) {
  size_t a = 0, n = strlen(s);
  while (a < n && is_ws((unsigned char)s[a])) a++;
  return substr(s, a, n);
}
char *cs_str_trim_end(const char *s) {
  size_t n = strlen(s), b = n;
  while (b > 0 && is_ws((unsigned char)s[b - 1])) b--;
  return substr(s, 0, b);
}

// JS padStart/padEnd: pad `s` with copies of `pad` (truncated to fit) until it reaches
// `target` length. If already long enough, or `pad` is empty, returns `s` unchanged.
static char *pad(const char *s, double dtarget, const char *padstr, int at_start) {
  size_t n = strlen(s), lp = strlen(padstr);
  long target = (long)dtarget;
  if (target < 0 || (size_t)target <= n || lp == 0) return substr(s, 0, n);
  size_t fill = (size_t)target - n;
  char *r = GC_malloc((size_t)target + 1);
  char *dst = at_start ? r : r + n; // where the pad block goes
  for (size_t i = 0; i < fill; i++) dst[i] = padstr[i % lp];
  memcpy(at_start ? r + fill : r, s, n);
  r[target] = '\0';
  return r;
}
char *cs_str_pad_start(const char *s, double target, const char *padstr) {
  return pad(s, target, padstr, 1);
}
char *cs_str_pad_end(const char *s, double target, const char *padstr) {
  return pad(s, target, padstr, 0);
}

// ECMAScript parseInt(str, radix). Faithful to the spec: skip leading whitespace, optional
// sign, `0x` prefix for radix 16, parse digits valid in the radix, stop at the first invalid
// char; no valid digits → NaN. `dradix` of 0 means the argument was omitted (default 10, with
// 0x auto-detect). Digits beyond '9' use letters a–z (case-insensitive), value 10–35.
double cs_parse_int(const char *s, double dradix) {
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
// otherwise the token must start with a digit or '.', which rejects "inf"/"nan"/identifiers
// that strtod would otherwise consume. A leading "0x" parses only the "0" (JS stops at 'x').
double cs_parse_float(const char *s) {
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
void *cs_str_split(const char *s, const char *sep) {
  void *arr = cs_array_new();
  size_t ls = strlen(s), lsep = strlen(sep);
  if (lsep == 0) {
    for (size_t i = 0; i < ls; i++) cs_array_push(arr, (long)(size_t)substr(s, i, i + 1));
    return arr;
  }
  size_t start = 0;
  const char *hit;
  while ((hit = strstr(s + start, sep)) != NULL) {
    size_t end = (size_t)(hit - s);
    cs_array_push(arr, (long)(size_t)substr(s, start, end));
    start = end + lsep;
  }
  cs_array_push(arr, (long)(size_t)substr(s, start, ls));
  return arr;
}
