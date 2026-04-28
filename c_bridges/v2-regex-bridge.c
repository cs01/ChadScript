#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>



typedef struct rure rure;
typedef struct rure_options rure_options;
typedef struct rure_match { size_t start; size_t end; } rure_match;
typedef struct rure_error rure_error;

#define RURE_FLAG_CASEI   (1u << 0)
#define RURE_FLAG_MULTI   (1u << 1)
#define RURE_FLAG_DOTNL   (1u << 2)
#define RURE_FLAG_UNICODE (1u << 5)
#define RURE_DEFAULT_FLAGS RURE_FLAG_UNICODE

extern rure *rure_compile(const uint8_t *pattern, size_t length,
                          uint32_t flags, rure_options *options,
                          rure_error *error);
extern bool rure_is_match(rure *re, const uint8_t *haystack, size_t length,
                          size_t start);
extern bool rure_find(rure *re, const uint8_t *haystack, size_t length,
                      size_t start, rure_match *match);

typedef struct {
    rure *re;
    int global;
} cs2_regex;

void *cs2_regex_new(const char *pattern, const char *flags) {
    uint32_t rflags = RURE_DEFAULT_FLAGS;
    int global = 0;
    if (flags) {
        for (const char *p = flags; *p; p++) {
            switch (*p) {
                case 'i': rflags |= RURE_FLAG_CASEI; break;
                case 'm': rflags |= RURE_FLAG_MULTI; break;
                case 's': rflags |= RURE_FLAG_DOTNL; break;
                case 'g': global = 1; break;
                default: break;
            }
        }
    }
    rure *re = rure_compile((const uint8_t *)pattern, strlen(pattern),
                            rflags, NULL, NULL);
    if (!re) return NULL;
    cs2_regex *rx = (cs2_regex *)malloc(sizeof(cs2_regex));
    rx->re = re;
    rx->global = global;
    return rx;
}

int cs2_regex_test(void *regex, const char *str) {
    if (!regex || !str) return 0;
    cs2_regex *rx = (cs2_regex *)regex;
    return rure_is_match(rx->re, (const uint8_t *)str, strlen(str), 0) ? 1 : 0;
}

char *cs2_regex_exec_match(void *regex, const char *str) {
    if (!regex || !str) return NULL;
    cs2_regex *rx = (cs2_regex *)regex;
    rure_match m;
    size_t slen = strlen(str);
    if (!rure_find(rx->re, (const uint8_t *)str, slen, 0, &m)) return NULL;
    size_t mlen = m.end - m.start;
    char *result = (char *)malloc(mlen + 1);
    memcpy(result, str + m.start, mlen);
    result[mlen] = '\0';
    return result;
}

char *cs2_string_match(const char *str, void *regex) {
    return cs2_regex_exec_match(regex, str);
}

char *cs2_string_replace_regex(const char *str, void *regex, const char *replacement) {
    if (!str || !regex || !replacement) return (char *)str;
    cs2_regex *rx = (cs2_regex *)regex;
    size_t slen = strlen(str);
    size_t rlen = strlen(replacement);

    size_t cap = slen + rlen + 64;
    char *out = (char *)malloc(cap);
    size_t out_len = 0;
    size_t pos = 0;

    while (pos <= slen) {
        rure_match m;
        if (!rure_find(rx->re, (const uint8_t *)str, slen, pos, &m)) break;

        size_t prefix_len = m.start - pos;
        size_t needed = out_len + prefix_len + rlen + (slen - m.end) + 1;
        if (needed > cap) {
            cap = needed * 2;
            char *tmp = (char *)malloc(cap);
            memcpy(tmp, out, out_len);
            out = tmp;
        }

        memcpy(out + out_len, str + pos, prefix_len);
        out_len += prefix_len;
        memcpy(out + out_len, replacement, rlen);
        out_len += rlen;
        pos = m.end;
        if (m.start == m.end) pos++;

        if (!rx->global) break;
    }

    size_t tail = slen - pos;
    size_t needed = out_len + tail + 1;
    if (needed > cap) {
        cap = needed;
        char *tmp = (char *)malloc(cap);
        memcpy(tmp, out, out_len);
        out = tmp;
    }
    memcpy(out + out_len, str + pos, tail);
    out_len += tail;
    out[out_len] = '\0';
    return out;
}
