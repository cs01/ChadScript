// Map runtime. Insertion-ordered entries (matches JS iteration order exactly) plus an
// open-addressed hash index over them, so lookup is O(1) while keys()/values() stay a straight
// walk of the entry arrays. Keys compare with SameValueZero (JS Map key equality: -0 and +0 are
// the same key, NaN equals NaN — unlike `===`), which the hash must respect too: -0 and NaN are
// normalized before hashing, or equal keys could land in different buckets.
// Keys and values are uniform i64 slots (same boxing as arrays).

#include <stdint.h>
#include <string.h>
#include <math.h>
#include <gc.h>
#include "strings.h"
#include "hashkey.h"

extern char cs_undefined_marker; // the `undefined` sentinel (see nullable.c)

typedef struct {
  int64_t *keys;
  int64_t *vals;
  int32_t len;
  int32_t cap;
  CsIndex idx; // bucket -> entry position; see hashkey.h
} CsMap;


CsMap *cs_map_new(void) {
  CsMap *m = GC_malloc(sizeof(CsMap));
  m->keys = 0;
  m->vals = 0;
  m->len = 0;
  m->cap = 0;
  m->idx.buckets = 0;
  m->idx.cap = 0;
  return m;
}

static int32_t find(CsMap *m, int64_t k, int32_t kind) {
  return cs_index_find(&m->idx, m->keys, k, kind);
}

// Insert or overwrite. Existing key → update value in place (keeps insertion position, JS
// semantics); new key → append (geometric growth of the parallel key/value buffers).
void cs_map_set(CsMap *m, int64_t k, int64_t v, int32_t kind) {
  int32_t i = find(m, k, kind);
  if (i >= 0) {
    m->vals[i] = v;
    return;
  }
  if (m->len == m->cap) {
    int32_t nc = m->cap == 0 ? 4 : m->cap * 2;
    int64_t *nk = GC_malloc((size_t)nc * sizeof(int64_t));
    int64_t *nv = GC_malloc((size_t)nc * sizeof(int64_t));
    if (m->len) {
      memcpy(nk, m->keys, (size_t)m->len * sizeof(int64_t));
      memcpy(nv, m->vals, (size_t)m->len * sizeof(int64_t));
    }
    m->keys = nk;
    m->vals = nv;
    m->cap = nc;
  }
  m->keys[m->len] = k;
  m->vals[m->len] = v;
  m->len++;
  if (cs_index_should_grow(&m->idx, m->len)) {
    cs_index_rebuild(&m->idx, m->keys, m->len, m->idx.cap == 0 ? 16 : m->idx.cap * 2, kind);
  } else {
    cs_index_insert(&m->idx, k, m->len - 1, kind);
  }
}

// get → `value | undefined`: found → a GC box holding the value slot; missing → the sentinel.
void *cs_map_get(CsMap *m, int64_t k, int32_t kind) {
  int32_t i = find(m, k, kind);
  if (i < 0) return &cs_undefined_marker;
  int64_t *box = GC_malloc(sizeof(int64_t));
  *box = m->vals[i];
  return box;
}

int32_t cs_map_has(CsMap *m, int64_t k, int32_t kind) { return find(m, k, kind) >= 0 ? 1 : 0; }

int32_t cs_map_delete(CsMap *m, int64_t k, int32_t kind) {
  int32_t i = find(m, k, kind);
  if (i < 0) return 0;
  // Entries stay densely packed in insertion order, so removal shifts everything after `i` and
  // every stored bucket index becomes stale — rebuild the table. Deletes are rare; lookups are not.
  memmove(&m->keys[i], &m->keys[i + 1], (size_t)(m->len - i - 1) * sizeof(int64_t));
  memmove(&m->vals[i], &m->vals[i + 1], (size_t)(m->len - i - 1) * sizeof(int64_t));
  m->len--;
  cs_index_rebuild(&m->idx, m->keys, m->len, m->idx.cap, kind);
  return 1;
}

int32_t cs_map_size(CsMap *m) { return m->len; }

// keys()/values() → a fresh array of the boxed slots, in insertion order (JS iteration order).
extern void *cs_array_new(void);
extern int32_t cs_array_push(void *a, int64_t slot);
void *cs_map_keys(CsMap *m) {
  void *a = cs_array_new();
  for (int32_t i = 0; i < m->len; i++) cs_array_push(a, m->keys[i]);
  return a;
}
void *cs_map_values(CsMap *m) {
  void *a = cs_array_new();
  for (int32_t i = 0; i < m->len; i++) cs_array_push(a, m->vals[i]);
  return a;
}
