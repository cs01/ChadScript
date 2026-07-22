// Array runtime. A single uniform representation serves every element type: each element is one
// 8-byte slot (int64_t). Codegen boxes an element into a slot before pushing (number → bitcast
// double, string → pointer bits, boolean → 0/1) and unboxes on read. This keeps one array
// implementation for number[]/string[]/boolean[] rather than one per element type.
//
// The struct and its data buffer are GC-allocated, so arrays are reclaimed when unreachable.

#include <stdint.h>
#include <string.h>
#include <gc.h>

typedef struct {
  int64_t *data;
  int32_t len;
  int32_t cap;
} CsArray;

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
