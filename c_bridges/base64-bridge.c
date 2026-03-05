// base64-bridge.c — base64 decode for Buffer.from(str, 'base64') support.
// Returns a heap-allocated %Uint8Array struct (GC-managed).

#include <stdint.h>
#include <string.h>

extern void* GC_malloc_atomic(size_t sz);
extern void* GC_malloc(size_t sz);

typedef struct { char* data; int len; int cap; } CsUint8Array;

static const signed char b64_dec[256] = {
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
    52,53,54,55,56,57,58,59,60,61,-1,-1,-1, 0,-1,-1,
    -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
    15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
    -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
    41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1
};

void* cs_base64_decode(const char* input) {
    if (!input) {
        CsUint8Array* arr = (CsUint8Array*)GC_malloc(sizeof(CsUint8Array));
        arr->data = NULL; arr->len = 0; arr->cap = 0;
        return arr;
    }

    const char* p = input;
    const char* marker = strstr(p, ";base64,");
    if (marker) p = marker + 8;

    size_t in_len = strlen(p);
    size_t max_out = (in_len / 4) * 3 + 4;
    char* out = (char*)GC_malloc_atomic(max_out);

    size_t out_pos = 0;
    int buf = 0, bits = 0;
    for (size_t i = 0; i < in_len; i++) {
        signed char v = b64_dec[(unsigned char)p[i]];
        if (v < 0) continue;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[out_pos++] = (char)(buf >> bits);
            buf &= (1 << bits) - 1;
        }
    }

    CsUint8Array* arr = (CsUint8Array*)GC_malloc(sizeof(CsUint8Array));
    arr->data = out;
    arr->len = (int)out_pos;
    arr->cap = (int)out_pos;
    return arr;
}
