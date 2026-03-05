#include <stddef.h>
#include <string.h>

extern void *GC_malloc_atomic(size_t);

static const char b64_enc[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

char *cs_btoa(const char *src, int len) {
    int out_len = ((len + 2) / 3) * 4;
    char *out = (char *)GC_malloc_atomic((size_t)(out_len + 1));
    int i = 0, j = 0;
    while (i < len) {
        unsigned int b0 = (unsigned char)src[i++];
        unsigned int b1 = i < len ? (unsigned char)src[i++] : 0;
        unsigned int b2 = i < len ? (unsigned char)src[i++] : 0;
        out[j++] = b64_enc[(b0 >> 2) & 0x3F];
        out[j++] = b64_enc[((b0 & 0x3) << 4) | ((b1 >> 4) & 0xF)];
        out[j++] = (i - 1 < len || (i - 1 == len && b1)) ? b64_enc[((b1 & 0xF) << 2) | ((b2 >> 6) & 0x3)] : '=';
        out[j++] = (i < len || i == len + 1) ? b64_enc[b2 & 0x3F] : '=';
    }
    out[j] = '\0';
    return out;
}

static int b64_decode_char(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

char *cs_atob(const char *src, int *out_len) {
    int src_len = (int)strlen(src);
    int max_out = (src_len / 4) * 3;
    char *out = (char *)GC_malloc_atomic((size_t)(max_out + 1));
    int j = 0;
    for (int i = 0; i < src_len; i += 4) {
        int c0 = b64_decode_char(src[i]);
        int c1 = i + 1 < src_len ? b64_decode_char(src[i + 1]) : 0;
        int c2 = i + 2 < src_len ? b64_decode_char(src[i + 2]) : 0;
        int c3 = i + 3 < src_len ? b64_decode_char(src[i + 3]) : 0;
        if (c0 < 0 || c1 < 0) break;
        out[j++] = (char)((c0 << 2) | (c1 >> 4));
        if (i + 2 < src_len && src[i + 2] != '=') out[j++] = (char)((c1 << 4) | (c2 >> 2));
        if (i + 3 < src_len && src[i + 3] != '=') out[j++] = (char)((c2 << 6) | c3);
    }
    out[j] = '\0';
    if (out_len) *out_len = j;
    return out;
}
