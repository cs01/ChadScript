#include <string.h>
#include <stdint.h>
#include <stddef.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);

void *cs2_arena_alloc(size_t size) { return GC_malloc(size); }
void cs2_arena_reset(void) {}
void cs2_arena_save(void) {}
void cs2_arena_restore(void) {}

void *cs2_alloc(int64_t size) { return GC_malloc((size_t)size); }
void *cs2_alloc_atomic(int64_t size) { return GC_malloc_atomic((size_t)size); }
