#include <stddef.h>
#include <string.h>

extern void *GC_malloc_atomic(size_t);

static const char hex[] = "0123456789ABCDEF";

static int is_unreserved(unsigned char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
           (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '!' ||
           c == '~' || c == '*' || c == '\'' || c == '(' || c == ')';
}

char *cs_encode_uri_component(const char *src) {
    int len = (int)strlen(src);
    char *out = (char *)GC_malloc_atomic((size_t)(len * 3 + 1));
    int j = 0;
    for (int i = 0; i < len; i++) {
        unsigned char c = (unsigned char)src[i];
        if (is_unreserved(c)) {
            out[j++] = (char)c;
        } else {
            out[j++] = '%';
            out[j++] = hex[c >> 4];
            out[j++] = hex[c & 0xF];
        }
    }
    out[j] = '\0';
    return out;
}

static int hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

char *cs_decode_uri_component(const char *src) {
    int len = (int)strlen(src);
    char *out = (char *)GC_malloc_atomic((size_t)(len + 1));
    int j = 0;
    for (int i = 0; i < len; i++) {
        if (src[i] == '%' && i + 2 < len) {
            int hi = hex_val(src[i + 1]);
            int lo = hex_val(src[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out[j++] = (char)((hi << 4) | lo);
                i += 2;
                continue;
            }
        }
        out[j++] = src[i];
    }
    out[j] = '\0';
    return out;
}
