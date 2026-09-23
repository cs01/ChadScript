// The runtime's C residue: only what Milo cannot express. Everything else is runtime/*.milo.
// Each item says why it is not Milo.

// ucontext_t's full layout (macOS inlines the machine context only under _XOPEN_SOURCE; without it
// getcontext writes past the struct), so this must precede every include.
#define _XOPEN_SOURCE 700
// _XOPEN_SOURCE hides Darwin's non-POSIX API (pthread_get_stackaddr_np); this restores it.
#define _DARWIN_C_SOURCE
#include <pthread.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
// ucontext is deprecated on macOS but has no replacement with the same whole-stack-swap semantics.
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#include <ucontext.h>
#ifdef __APPLE__
#include <mach-o/getsect.h>
#include <mach-o/ldsyms.h>
#endif

// The collector's platform seam (runtime/gc.milo). Each piece needs a data symbol, a platform API
// or a compiler builtin that Milo cannot reach.
//
// The bump-allocation region. Generated IR inlines the allocation fast path, so the region is a
// data symbol with a fixed C name, which Milo cannot define.
struct {
  uint64_t cursor, limit;
} cs_gc_bump;
void *cs_gc_bump_ptr(void) { return &cs_gc_bump; }

// Highest address of the main thread's stack, where the conservative stack scan ends. glibc
// exports __libc_stack_end (just above main's frame); Darwin has a pthread query.
uint64_t cs_stack_top(void) {
#ifdef __APPLE__
  return (uint64_t)pthread_get_stackaddr_np(pthread_self());
#else
  extern void *__libc_stack_end;
  return (uint64_t)__libc_stack_end;
#endif
}

// The executable's writable static data, where every global lives (the program's module variables
// and codegen caches, the runtime's Milo globals): one conservatively scanned root range. The
// bounds are linker-defined symbols.
uint64_t cs_gc_data_lo(void) {
#ifdef __APPLE__
  unsigned long size;
  return (uint64_t)getsegmentdata(&_mh_execute_header, "__DATA", &size);
#else
  extern char __data_start[];
  return (uint64_t)__data_start;
#endif
}
uint64_t cs_gc_data_hi(void) {
#ifdef __APPLE__
  unsigned long size = 0;
  return (uint64_t)getsegmentdata(&_mh_execute_header, "__DATA", &size) + size;
#else
  extern char _end[];
  return (uint64_t)_end;
#endif
}

// An address below every frame of its caller (a noinline callee's frame address): where the
// collector starts scanning the running stack.
__attribute__((noinline)) uint64_t cs_sp(void) { return (uint64_t)__builtin_frame_address(0); }

// The SP saved in a ucontext by swapcontext: where the scan of a suspended stack starts. The
// machine-context layout is per platform. Under _XOPEN_SOURCE alone glibc spells the x86-64
// register array __gregs, and the RSP index (REG_RSP = 15) has no name.
uint64_t cs_ctx_sp(ucontext_t *c) {
#if defined(__APPLE__) && defined(__aarch64__)
  return c->uc_mcontext->__ss.__sp;
#elif defined(__APPLE__) && defined(__x86_64__)
  return c->uc_mcontext->__ss.__rsp;
#elif defined(__linux__) && defined(__x86_64__)
  return (uint64_t)c->uc_mcontext.__gregs[15];
#elif defined(__linux__) && defined(__aarch64__)
  return c->uc_mcontext.__sp;
#else
#error "cs_ctx_sp: add this platform's saved-SP field"
#endif
}

// Under ASan the collector poisons free lines and unpoisons a hole when it hands it out, so a
// runtime read of a collected object is reported until its line is reused. The interface is a
// sanitizer header, reachable only from C; without ASan these are no-ops. (The runtime is always
// compiled by clang, which defines __has_feature.)
#if __has_feature(address_sanitizer)
#include <sanitizer/asan_interface.h>
void cs_gc_poison(uint64_t p, uint64_t n) { __asan_poison_memory_region((void *)p, n); }
void cs_gc_unpoison(uint64_t p, uint64_t n) { __asan_unpoison_memory_region((void *)p, n); }
#else
void cs_gc_poison(uint64_t p, uint64_t n) {}
void cs_gc_unpoison(uint64_t p, uint64_t n) {}
#endif

// Conservative scan of [lo, hi): `visit` every aligned word inside the heap's address range. Not
// ASan-instrumented: stacks and static data hold redzones, and this reads them on purpose.
__attribute__((no_sanitize("address"))) void cs_gc_scan(uint64_t lo, uint64_t hi, uint64_t heapLo,
                                                        uint64_t heapHi, void (*visit)(uint64_t)) {
  for (uint64_t *p = (uint64_t *)((lo + 7) & ~(uint64_t)7); (uint64_t)(p + 1) <= hi; p++)
    if (*p - heapLo < heapHi - heapLo) visit(*p);
}

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
