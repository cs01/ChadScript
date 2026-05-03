#ifndef CS2_ALLOC_H
#define CS2_ALLOC_H
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

#include <stdint.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);
extern void *GC_realloc(void *, size_t);
extern void *cs2_alloc(int64_t);
extern void *cs2_alloc_atomic(int64_t);

#define malloc(n)       cs2_alloc((int64_t)(n))
#define calloc(n, s)    cs2_alloc((int64_t)(n) * (int64_t)(s))
#define realloc(p, n)   GC_realloc((p), (size_t)(n))
#define free(p)         ((void)(p))

#endif
