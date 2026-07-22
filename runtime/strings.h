// String runtime ABI. JS strings are UTF-8 {data,len} (charter-locked), passed across the
// codegen boundary as a `CsString*` (a single opaque `ptr` at the IR level — see builder.cstring).
// `data` is NOT guaranteed NUL-terminated and MAY contain embedded NUL bytes; `len` is the sole
// authority on length. Never call strlen/strcmp/strstr/fputs on `data` — they truncate at the
// first NUL and silently diverge from Node. ASCII-exact per the Phase-4 unicode decision.
#ifndef CS_STRINGS_H
#define CS_STRINGS_H

#include <stddef.h>

typedef struct {
  const char *data;
  size_t len;
} CsString;

// Wrap an already-stable buffer (a static literal, or GC memory the caller just filled) into a
// CsString header WITHOUT copying. The buffer must outlive the header; when it is GC memory, the
// returned (GC-allocated) header holds the only interior pointer that keeps it reachable.
CsString *cs_str_mk(const char *data, size_t len);
// Copy `len` bytes into fresh GC memory and wrap them.
CsString *cs_str_from(const char *data, size_t len);
// First index of needle in haystack at/after byte `from`, or -1. Empty needle → clamp(from,len).
// NUL-safe replacement for strstr.
long cs_mem_find(const char *h, size_t hlen, const char *n, size_t nlen, size_t from);

CsString *cs_str_concat(const CsString *a, const CsString *b);
CsString *cs_num_to_string(double x);
CsString *cs_bool_to_string(int b);
int cs_str_eq(const CsString *a, const CsString *b);

#endif
