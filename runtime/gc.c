// Boehm GC bootstrap. cs_gc_init() is emitted as the first instruction of `main` (see codegen).
// GC_INIT() is the recommended way to start the collector from the program's main thread before
// any allocation. Runtime heap users call GC_malloc directly (they #include <gc.h>).

#include <gc.h>
#include <stdint.h>

void cs_gc_init(void) { GC_INIT(); }

// Raw GC allocation, used for object records (an i64 slot per field).
void *cs_gc_alloc(int64_t n) { return GC_malloc((size_t)n); }
