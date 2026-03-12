#include <string.h>

static const char *cached_ptr = 0;
static long long cached_len = 0;

long long cs_cached_strlen(const char *s) {
    if (s == cached_ptr) return cached_len;
    cached_len = (long long)strlen(s);
    cached_ptr = s;
    return cached_len;
}
