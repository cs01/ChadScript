// Set runtime. Mirrors the Map design: linear-scan, insertion-ordered, elements compared with
// SameValueZero (so NaN is a usable element and -0/+0 collapse). Elements are uniform i64 slots.
// O(n) membership — correctness first; a hash index is a later optimization.

#include <stdint.h>
#include <string.h>
#include <math.h>
#include <gc.h>
#include "strings.h"

typedef struct {
  int64_t *elems;
  int32_t len;
  int32_t cap;
} CsSet;

enum { KEY_NUMBER = 0, KEY_STRING = 1, KEY_BOOLEAN = 2 };

CsSet *cs_set_new(void) {
  CsSet *s = GC_malloc(sizeof(CsSet));
  s->elems = 0;
  s->len = 0;
  s->cap = 0;
  return s;
}

static int elem_eq(int64_t a, int64_t b, int32_t kind) {
  if (kind == KEY_STRING) return cs_str_eq((const CsString *)(intptr_t)a, (const CsString *)(intptr_t)b);
  if (kind == KEY_NUMBER) {
    double x, y;
    memcpy(&x, &a, sizeof(double));
    memcpy(&y, &b, sizeof(double));
    return (x == y) || (isnan(x) && isnan(y)); // SameValueZero
  }
  return a == b;
}

static int32_t find(CsSet *s, int64_t e, int32_t kind) {
  for (int32_t i = 0; i < s->len; i++)
    if (elem_eq(s->elems[i], e, kind)) return i;
  return -1;
}

void cs_set_add(CsSet *s, int64_t e, int32_t kind) {
  if (find(s, e, kind) >= 0) return; // already present — no-op, keeps first insertion order
  if (s->len == s->cap) {
    int32_t nc = s->cap == 0 ? 4 : s->cap * 2;
    int64_t *ne = GC_malloc((size_t)nc * sizeof(int64_t));
    if (s->len) memcpy(ne, s->elems, (size_t)s->len * sizeof(int64_t));
    s->elems = ne;
    s->cap = nc;
  }
  s->elems[s->len++] = e;
}

int32_t cs_set_has(CsSet *s, int64_t e, int32_t kind) { return find(s, e, kind) >= 0 ? 1 : 0; }

int32_t cs_set_delete(CsSet *s, int64_t e, int32_t kind) {
  int32_t i = find(s, e, kind);
  if (i < 0) return 0;
  memmove(&s->elems[i], &s->elems[i + 1], (size_t)(s->len - i - 1) * sizeof(int64_t));
  s->len--;
  return 1;
}

int32_t cs_set_size(CsSet *s) { return s->len; }

// values()/keys() → a fresh array of the boxed element slots, in insertion order.
extern void *cs_array_new(void);
extern int32_t cs_array_push(void *a, int64_t slot);
void *cs_set_values(CsSet *s) {
  void *a = cs_array_new();
  for (int32_t i = 0; i < s->len; i++) cs_array_push(a, s->elems[i]);
  return a;
}

// `new Set(array)`: add each element of a uniform-slot array (dedup applied by cs_set_add).
extern int32_t cs_array_len(void *a);
extern int64_t cs_array_get(void *a, int32_t i);
CsSet *cs_set_from_array(void *arr, int32_t kind) {
  CsSet *s = cs_set_new();
  int32_t n = cs_array_len(arr);
  for (int32_t i = 0; i < n; i++) cs_set_add(s, cs_array_get(arr, i), kind);
  return s;
}
