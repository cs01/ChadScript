// Map runtime. First cut: linear-scan, insertion-ordered (matches JS iteration order exactly),
// keys compared with SameValueZero (JS Map key equality: -0 and +0 are the same key, NaN equals
// NaN — unlike `===`). Keys and values are uniform i64 slots (same boxing as arrays). O(n) per
// lookup — correctness first; a hash index is a later optimization.

#include <stdint.h>
#include <string.h>
#include <math.h>
#include <gc.h>

extern char cs_undefined_marker; // the `undefined` sentinel (see nullable.c)

typedef struct {
  int64_t *keys;
  int64_t *vals;
  int32_t len;
  int32_t cap;
} CsMap;

// Key kind tags (passed by codegen, since equality depends on the key's source type).
enum { KEY_NUMBER = 0, KEY_STRING = 1, KEY_BOOLEAN = 2 };

CsMap *cs_map_new(void) {
  CsMap *m = GC_malloc(sizeof(CsMap));
  m->keys = 0;
  m->vals = 0;
  m->len = 0;
  m->cap = 0;
  return m;
}

static int key_eq(int64_t a, int64_t b, int32_t kind) {
  if (kind == KEY_STRING) {
    return strcmp((const char *)(intptr_t)a, (const char *)(intptr_t)b) == 0;
  }
  if (kind == KEY_NUMBER) {
    double x, y;
    memcpy(&x, &a, sizeof(double));
    memcpy(&y, &b, sizeof(double));
    // SameValueZero: equal numbers, OR both NaN (so NaN is a usable Map key).
    return (x == y) || (isnan(x) && isnan(y));
  }
  return a == b; // boolean: raw slot compare
}

static int32_t find(CsMap *m, int64_t k, int32_t kind) {
  for (int32_t i = 0; i < m->len; i++)
    if (key_eq(m->keys[i], k, kind)) return i;
  return -1;
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
  memmove(&m->keys[i], &m->keys[i + 1], (size_t)(m->len - i - 1) * sizeof(int64_t));
  memmove(&m->vals[i], &m->vals[i + 1], (size_t)(m->len - i - 1) * sizeof(int64_t));
  m->len--;
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
