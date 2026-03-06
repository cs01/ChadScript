#include <string.h>
#include <stdint.h>

extern void* GC_malloc_atomic(size_t sz);

static const char hex_chars[17] = "0123456789ABCDEF";

static int is_unreserved(unsigned char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
           (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
}

char* cs_encode_uri_component(const char* input) {
    if (!input) {
        char* out = (char*)GC_malloc_atomic(1);
        out[0] = '\0';
        return out;
    }
    size_t in_len = strlen(input);
    char* out = (char*)GC_malloc_atomic(in_len * 3 + 1);
    size_t j = 0;
    for (size_t i = 0; i < in_len; i++) {
        unsigned char c = (unsigned char)input[i];
        if (is_unreserved(c)) {
            out[j++] = (char)c;
        } else {
            out[j++] = '%';
            out[j++] = hex_chars[(c >> 4) & 0xF];
            out[j++] = hex_chars[c & 0xF];
        }
    }
    out[j] = '\0';
    return out;
}

static int hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}

char* cs_decode_uri_component(const char* input) {
    if (!input) {
        char* out = (char*)GC_malloc_atomic(1);
        out[0] = '\0';
        return out;
    }
    size_t in_len = strlen(input);
    char* out = (char*)GC_malloc_atomic(in_len + 1);
    size_t j = 0;
    for (size_t i = 0; i < in_len; i++) {
        if (input[i] == '%' && i + 2 < in_len) {
            int hi = hex_val(input[i + 1]);
            int lo = hex_val(input[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out[j++] = (char)((hi << 4) | lo);
                i += 2;
                continue;
            }
        }
        out[j++] = input[i];
    }
    out[j] = '\0';
    return out;
}
