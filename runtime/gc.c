// Boehm GC bootstrap. cs_gc_init() is emitted as the first instruction of `main` (see codegen).
// GC_INIT() is the recommended way to start the collector from the program's main thread before
// any allocation. Runtime heap users call GC_malloc directly (they #include <gc.h>).

#include <gc.h>

void cs_gc_init(void) { GC_INIT(); }
