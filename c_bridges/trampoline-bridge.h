#ifndef CS_TRAMPOLINE_BRIDGE_H
#define CS_TRAMPOLINE_BRIDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Allocate a slot holding `env`. Returns a non-negative handle, or -1 if
// the slot table has hit its hard cap (1 << 20 entries).
int32_t cs_tramp_alloc(void *env);

// Read-only lookup. Returns NULL for out-of-range or freed handles.
void *cs_tramp_get(int32_t handle);

// Idempotent — safe to call twice. NULLs the slot and pushes it back
// onto the freelist.
void cs_tramp_free(int32_t handle);

// Debug observability: returns the number of currently-live slots.
int32_t cs_tramp_stats(void);

// --- ChadScript-ABI wrappers ---
// ChadScript `number` lowers to `double`; these shims let `declare function`
// bindings call the slot table without ABI mismatch. Codegen-emitted internal
// call sites use the int32 API above directly.
double cs_tramp_alloc_d(void *env);
void *cs_tramp_get_d(double handle);
void cs_tramp_free_d(double handle);
double cs_tramp_stats_d(void);

#ifdef __cplusplus
}
#endif

#endif
