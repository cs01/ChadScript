// Key hashing + open-addressed index shared by Map and Set. See hashkey.h for the contract.

#include "hashkey.h"
#include "strings.h"
#include <gc.h>
#include <math.h>
#include <string.h>

int cs_key_eq(int64_t a, int64_t b, int32_t kind) {
  if (kind == CS_KEY_STRING) {
    return cs_str_eq((const CsString *)(intptr_t)a, (const CsString *)(intptr_t)b);
  }
  if (kind == CS_KEY_NUMBER) {
    double x, y;
    memcpy(&x, &a, sizeof(double));
    memcpy(&y, &b, sizeof(double));
    // SameValueZero: equal numbers, OR both NaN (so NaN is a usable key).
    return (x == y) || (isnan(x) && isnan(y));
  }
  return a == b; // boolean: raw slot compare
}

uint64_t cs_key_hash(int64_t k, int32_t kind) {
  uint64_t h = 1469598103934665603ULL; // FNV-1a offset basis
  const unsigned char *p;
  size_t n;
  double d;
  int64_t bits;
  if (kind == CS_KEY_STRING) {
    // Hash the BYTES, not the pointer: two distinct CsString objects with the same contents are
    // the same key. Length is the authority (the buffer may contain embedded NULs).
    const CsString *s = (const CsString *)(intptr_t)k;
    p = (const unsigned char *)s->data;
    n = s->len;
  } else if (kind == CS_KEY_NUMBER) {
    memcpy(&d, &k, sizeof(double));
    if (d == 0.0) d = 0.0;         // collapses -0 to +0, matching cs_key_eq
    if (isnan(d)) d = (double)NAN; // one canonical NaN, likewise
    memcpy(&bits, &d, sizeof(int64_t));
    p = (const unsigned char *)&bits;
    n = sizeof(int64_t);
  } else {
    p = (const unsigned char *)&k;
    n = sizeof(int64_t);
  }
  for (size_t i = 0; i < n; i++) {
    h ^= p[i];
    h *= 1099511628211ULL; // FNV-1a prime
  }
  return h;
}

void cs_index_rebuild(CsIndex *ix, const int64_t *entries, int32_t len, int32_t new_cap,
                      int32_t kind) {
  ix->cap = new_cap;
  ix->buckets = GC_malloc((size_t)new_cap * sizeof(int32_t));
  for (int32_t i = 0; i < new_cap; i++) ix->buckets[i] = -1;
  const uint32_t mask = (uint32_t)new_cap - 1;
  for (int32_t e = 0; e < len; e++) {
    uint32_t b = (uint32_t)cs_key_hash(entries[e], kind) & mask;
    while (ix->buckets[b] != -1) b = (b + 1) & mask;
    ix->buckets[b] = e;
  }
}

int32_t cs_index_find(const CsIndex *ix, const int64_t *entries, int64_t k, int32_t kind) {
  if (ix->cap == 0) return -1;
  const uint32_t mask = (uint32_t)ix->cap - 1;
  uint32_t b = (uint32_t)cs_key_hash(k, kind) & mask;
  // Terminates because the load factor keeps the table below full, so an empty bucket always
  // exists to end the probe.
  while (ix->buckets[b] != -1) {
    if (cs_key_eq(entries[ix->buckets[b]], k, kind)) return ix->buckets[b];
    b = (b + 1) & mask;
  }
  return -1;
}

void cs_index_insert(CsIndex *ix, int64_t k, int32_t pos, int32_t kind) {
  const uint32_t mask = (uint32_t)ix->cap - 1;
  uint32_t b = (uint32_t)cs_key_hash(k, kind) & mask;
  while (ix->buckets[b] != -1) b = (b + 1) & mask;
  ix->buckets[b] = pos;
}

int cs_index_should_grow(const CsIndex *ix, int32_t len) {
  return ix->cap == 0 || (int64_t)len * 10 > (int64_t)ix->cap * 7;
}
