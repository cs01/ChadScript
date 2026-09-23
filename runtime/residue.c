// The runtime's C residue: only what Milo cannot express. Everything else is runtime/*.milo.
// Each item says why it is not Milo.

#include <gc.h>
#include <stdio.h>

// GC_INIT is a macro (it can expand to more than a call, e.g. registering the data segment on
// some platforms), so it has to be expanded by a C compiler. Emitted first in `main`.
void cs_gc_init(void) { GC_INIT(); }

// Nullable `T | undefined` / `T | null`: generated IR compares an optional pointer against the
// ADDRESSES of these globals. Milo can neither define a data symbol with a fixed C name nor take
// the address of one, so they live here, with an accessor for the Milo side.
char cs_undefined_marker;
char cs_null_marker;
void *cs_undefined_ptr(void) { return &cs_undefined_marker; }

// stdout/stderr are data symbols (spelled __stdoutp/__stderrp on macOS), which Milo cannot name.
FILE *cs_stdout(void) { return stdout; }
FILE *cs_stderr(void) { return stderr; }
