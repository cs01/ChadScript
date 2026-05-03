#ifndef CS2_ALLOC_H
#define CS2_ALLOC_H
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);
extern void *GC_realloc(void *, size_t);

#define malloc(n)       GC_malloc((size_t)(n))
#define calloc(n, s)    GC_malloc((size_t)(n) * (size_t)(s))
#define realloc(p, n)   GC_realloc((p), (size_t)(n))
#define free(p)         ((void)(p))

#endif
