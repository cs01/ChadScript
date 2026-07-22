// CsString constructors and NUL-safe byte search — the shared primitives every string helper
// builds on. Strings are {data,len} (see strings.h); embedded NUL is an ordinary byte here.

#include <string.h>
#include <gc.h>
#include "strings.h"

CsString *cs_str_mk(const char *data, size_t len) {
  CsString *s = GC_malloc(sizeof(CsString));
  s->data = data;
  s->len = len;
  return s;
}

CsString *cs_str_from(const char *data, size_t len) {
  // GC_malloc(0) is legal but we keep the buffer non-empty so `data` is always a valid pointer.
  char *buf = GC_malloc(len ? len : 1);
  if (len) memcpy(buf, data, len);
  return cs_str_mk(buf, len);
}

long cs_mem_find(const char *h, size_t hlen, const char *n, size_t nlen, size_t from) {
  if (nlen == 0) return (long)(from <= hlen ? from : hlen);
  if (nlen > hlen) return -1;
  for (size_t i = from; i + nlen <= hlen; i++)
    if (memcmp(h + i, n, nlen) == 0) return (long)i;
  return -1;
}
