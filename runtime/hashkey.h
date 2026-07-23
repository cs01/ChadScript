// Shared key hashing + an open-addressed index, used by both Map and Set.
//
// The two must agree: any pair of keys that `cs_key_eq` calls equal MUST hash the same, or equal
// keys land in different buckets and a lookup misses. JS Map/Set compare with SameValueZero, so
// -0 and +0 are one key and NaN equals itself — both are normalized before hashing.
//
// The index maps a bucket to a POSITION in the owner's densely packed, insertion-ordered entry
// array. Keeping entries separate from buckets is what lets keys()/values() stay a straight walk
// in JS iteration order while lookup is O(1).
#ifndef CS_HASHKEY_H
#define CS_HASHKEY_H

#include <stdint.h>

// Key kind tags, passed by codegen (equality depends on the key's source type).
enum { CS_KEY_NUMBER = 0, CS_KEY_STRING = 1, CS_KEY_BOOLEAN = 2 };

typedef struct {
  int32_t *buckets; // bucket -> entry position, or -1 when empty
  int32_t cap;      // always a power of two, so the mask is a bitwise and
} CsIndex;

int cs_key_eq(int64_t a, int64_t b, int32_t kind);
uint64_t cs_key_hash(int64_t k, int32_t kind);

// Rebuild `ix` at `new_cap` buckets from the first `len` entries. Required after any operation
// that shifts entry positions (a delete), and on growth.
void cs_index_rebuild(CsIndex *ix, const int64_t *entries, int32_t len, int32_t new_cap,
                      int32_t kind);
// Entry position of `k`, or -1.
int32_t cs_index_find(const CsIndex *ix, const int64_t *entries, int64_t k, int32_t kind);
// Record that the key at entry position `pos` exists. The caller must have already ensured
// headroom via cs_index_should_grow.
void cs_index_insert(CsIndex *ix, int64_t k, int32_t pos, int32_t kind);
// True when `len` entries would push the table past its load factor.
int cs_index_should_grow(const CsIndex *ix, int32_t len);

#endif
