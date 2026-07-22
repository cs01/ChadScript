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
