// The runtime's C residue: only what Milo cannot express. Everything else is runtime/*.milo.
// Each item says why it is not Milo.

// ucontext_t's full layout (macOS inlines the machine context only under _XOPEN_SOURCE; without it
// getcontext writes past the struct), so this must precede every include.
#define _XOPEN_SOURCE 700
#include <gc.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
// ucontext is deprecated on macOS but has no replacement with the same whole-stack-swap semantics.
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#include <ucontext.h>

// GC_INIT is a macro (on some platforms it expands to more than a call, e.g. registering the data
// segment), so a C compiler has to expand it. Emitted first in `main`.
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

// errors.milo lays a try handler out as a jmp_buf followed by the thrown value at this fixed
// offset; jmp_buf's size is platform specific and only a C compiler knows it.
_Static_assert(sizeof(jmp_buf) <= 512, "errors.milo JMPBUF_BYTES is too small for this jmp_buf");

// Fiber contexts for async.milo. ucontext_t's size and field offsets are platform specific (and
// depend on _XOPEN_SOURCE, above), so creating one needs the C header. swapcontext itself takes
// only pointers and is called from Milo directly.
int64_t cs_fiber_ctx_size(void) { return (int64_t)sizeof(ucontext_t); }
void cs_fiber_ctx_init(ucontext_t *ctx, void *stack, int64_t size, void (*entry)(void)) {
  getcontext(ctx);
  ctx->uc_stack.ss_sp = stack;
  ctx->uc_stack.ss_size = (size_t)size;
  // The entry never returns (it switches away when the fiber finishes), so there is no successor.
  ctx->uc_link = NULL;
  makecontext(ctx, entry, 0);
}
