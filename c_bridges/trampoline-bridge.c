// trampoline-bridge.c — slot table for C-ABI trampoline closures.
//
// Motivation: ChadScript closures capture env by value, but many C APIs take
// a bare function pointer with no env param (e.g. libuv timer callbacks).
// The slot table lets the runtime stash a closure env and pass an integer
// handle where a C callback normally expects `void*`. A per-shape trampoline
// (emitted in LLVM IR) recovers the env via cs_tramp_get(handle) before
// calling the user lambda.
//
// PR1 scope: allocator only. Trampoline emission and bridge wiring land in
// later PRs. See §3 of the closure-CABI plan doc for design rationale.

#include "trampoline-bridge.h"

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef NDEBUG
#include <assert.h>
#endif

extern void *GC_malloc_uncollectable(size_t);
extern void *GC_realloc(void *, size_t);
extern void GC_free(void *);

// Single-threaded assumption (libuv event loop). A future
// -DCS_TRAMP_MT build would need a mutex around alloc/free/growth.
// TODO(CS_TRAMP_MT): guard these with a mutex when we support threads.

#define CS_TRAMP_INITIAL_CAP 1024
#define CS_TRAMP_MAX_CAP (1 << 20)

static void **g_slots = NULL;        // env pointers (NULL = free)
static int32_t *g_freelist = NULL;   // stack of free indices
static int32_t g_freelist_len = 0;   // number of entries in freelist
static int32_t g_cap = 0;            // current capacity of g_slots
static int32_t g_next = 0;           // next fresh slot index (never reused)
static int32_t g_live = 0;           // live-slot count (observability)

// Grow g_slots to new_cap. Returns 0 on success, -1 on OOM / cap exceeded.
// Uses GC_malloc_uncollectable so Boehm scans env pointers conservatively
// but doesn't collect the table itself. Freelist is a plain malloc block —
// it stores ints, no pointers to trace.
static int cs_tramp_grow(int32_t new_cap) {
    if (new_cap > CS_TRAMP_MAX_CAP) {
        return -1;
    }
    void **new_slots;
    if (g_slots == NULL) {
        new_slots = (void **)GC_malloc_uncollectable((size_t)new_cap * sizeof(void *));
        if (new_slots == NULL) return -1;
        memset(new_slots, 0, (size_t)new_cap * sizeof(void *));
    } else {
        new_slots = (void **)GC_realloc(g_slots, (size_t)new_cap * sizeof(void *));
        if (new_slots == NULL) return -1;
        // Zero the newly-grown tail so probing a fresh slot returns NULL.
        memset(new_slots + g_cap, 0, (size_t)(new_cap - g_cap) * sizeof(void *));
    }
    g_slots = new_slots;

    // Freelist holds raw ints — plain realloc is fine.
    int32_t *new_fl = (int32_t *)realloc(g_freelist, (size_t)new_cap * sizeof(int32_t));
    if (new_fl == NULL) return -1;
    g_freelist = new_fl;

    g_cap = new_cap;
    return 0;
}

int32_t cs_tramp_alloc(void *env) {
    // Fast path: pop a recycled slot.
    if (g_freelist_len > 0) {
        int32_t h = g_freelist[--g_freelist_len];
        g_slots[h] = env;
        g_live++;
        return h;
    }

    // No recycled slot — grow if we're out of fresh indices.
    if (g_next >= g_cap) {
        int32_t new_cap = g_cap == 0 ? CS_TRAMP_INITIAL_CAP : g_cap * 2;
        if (new_cap > CS_TRAMP_MAX_CAP) new_cap = CS_TRAMP_MAX_CAP;
        if (new_cap <= g_cap) {
            // Already at hard cap.
            return -1;
        }
        if (cs_tramp_grow(new_cap) != 0) {
            return -1;
        }
    }

    int32_t h = g_next++;
    g_slots[h] = env;
    g_live++;
    return h;
}

void *cs_tramp_get(int32_t handle) {
    if (handle < 0 || handle >= g_next) return NULL;
    return g_slots[handle];
}

void cs_tramp_free(int32_t handle) {
    if (handle < 0 || handle >= g_next) {
#ifndef NDEBUG
        // Handle out of range — almost certainly a double-free bug in the
        // caller. Debug builds trip the assert; release silently no-ops so
        // a stray clearTimeout() on an already-fired timer can't crash.
        assert(0 && "cs_tramp_free: handle out of range");
#endif
        return;
    }
    if (g_slots[handle] == NULL) {
        // Already freed — idempotent no-op.
        return;
    }
    g_slots[handle] = NULL;
    g_freelist[g_freelist_len++] = handle;
    if (g_live > 0) g_live--;
}

int32_t cs_tramp_stats(void) {
    return g_live;
}

// --- ChadScript-ABI wrappers ---
// The ChadScript `number` type lowers to LLVM `double`, so `declare function`
// calls bind through these `double`-typed shims. Codegen-generated trampoline
// call sites will use the `int32_t` API above directly.
double cs_tramp_alloc_d(void *env) {
    return (double)cs_tramp_alloc(env);
}

void *cs_tramp_get_d(double handle) {
    return cs_tramp_get((int32_t)handle);
}

void cs_tramp_free_d(double handle) {
    cs_tramp_free((int32_t)handle);
}

double cs_tramp_stats_d(void) {
    return (double)cs_tramp_stats();
}
