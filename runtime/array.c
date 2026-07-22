// Array runtime. A single uniform representation serves every element type: each element is one
// 8-byte slot (int64_t). Codegen boxes an element into a slot before pushing (number → bitcast
// double, string → pointer bits, boolean → 0/1) and unboxes on read. This keeps one array
// implementation for number[]/string[]/boolean[] rather than one per element type.
//
// The struct and its data buffer are GC-allocated, so arrays are reclaimed when unreachable.

#include <stdint.h>
#include <string.h>
#include <gc.h>

extern char cs_undefined_marker; // the `undefined` sentinel (see nullable.c)

typedef struct {
  int64_t *data;
  int32_t len;
  int32_t cap;
} CsArray;

// Box one i64 slot into an optional (a GC pointer to the slot). Used by pop/shift so they can
// return `element | undefined` directly.
static void *box_slot(int64_t slot) {
  int64_t *b = GC_malloc(sizeof(int64_t));
  *b = slot;
  return b;
}

CsArray *cs_array_new(void) {
  CsArray *a = GC_malloc(sizeof(CsArray));
  a->len = 0;
  a->cap = 0;
  a->data = 0;
  return a;
}

// Append one slot, growing the buffer geometrically. Returns the new length (JS `push` result).
int32_t cs_array_push(CsArray *a, int64_t slot) {
  if (a->len == a->cap) {
    int32_t ncap = a->cap == 0 ? 4 : a->cap * 2;
    int64_t *nd = GC_malloc((size_t)ncap * sizeof(int64_t));
    if (a->len > 0) memcpy(nd, a->data, (size_t)a->len * sizeof(int64_t));
    a->data = nd;
    a->cap = ncap;
  }
  a->data[a->len] = slot;
  return ++a->len;
}

int32_t cs_array_len(CsArray *a) { return a->len; }

// Raw slot read. Callers (for...of) stay within [0, len); index-access bounds semantics land
// with the nullable work.
int64_t cs_array_get(CsArray *a, int32_t i) { return a->data[i]; }

// Raw slot write, in bounds by construction (used by the in-place sort). Returns nothing.
void cs_array_set(CsArray *a, int32_t i, int64_t slot) { a->data[i] = slot; }

// pop: remove + return the last element as `element | undefined` (empty → undefined sentinel).
void *cs_array_pop(CsArray *a) {
  if (a->len == 0) return &cs_undefined_marker;
  return box_slot(a->data[--a->len]);
}

// shift: remove + return the first element as `element | undefined`; shifts the rest down.
void *cs_array_shift(CsArray *a) {
  if (a->len == 0) return &cs_undefined_marker;
  int64_t first = a->data[0];
  a->len--;
  memmove(a->data, a->data + 1, (size_t)a->len * sizeof(int64_t));
  return box_slot(first);
}

// reverse: in place; returns the same array (JS semantics — reverse returns `this`).
CsArray *cs_array_reverse(CsArray *a) {
  for (int32_t i = 0, j = a->len - 1; i < j; i++, j--) {
    int64_t t = a->data[i];
    a->data[i] = a->data[j];
    a->data[j] = t;
  }
  return a;
}

// slice: a new array of the elements in [start, end), with JS negative-index normalization.
static CsArray *slice_norm(CsArray *a, long start, long end) {
  long n = a->len;
  if (start < 0) start = start + n < 0 ? 0 : start + n;
  if (start > n) start = n;
  if (end < 0) end = end + n < 0 ? 0 : end + n;
  if (end > n) end = n;
  CsArray *r = cs_array_new();
  for (long i = start; i < end; i++) cs_array_push(r, a->data[i]);
  return r;
}
CsArray *cs_array_slice1(CsArray *a, double start) {
  return slice_norm(a, (long)start, a->len);
}
CsArray *cs_array_slice2(CsArray *a, double start, double end) {
  return slice_norm(a, (long)start, (long)end);
}

// concat: a new array = a followed by b.
CsArray *cs_array_concat(CsArray *a, CsArray *b) {
  CsArray *r = cs_array_new();
  for (int32_t i = 0; i < a->len; i++) cs_array_push(r, a->data[i]);
  for (int32_t i = 0; i < b->len; i++) cs_array_push(r, b->data[i]);
  return r;
}
