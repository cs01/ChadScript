// String method runtime. Strings are NUL-terminated cstrings (Phase 1); results that are new
// strings are GC-allocated. Semantics are JS-exact for ASCII (per the UTF-8 decision); the
// fuzzer stays ASCII-only.

#include <stdlib.h>
#include <string.h>
#include <ctype.h>
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
