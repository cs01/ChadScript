#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

extern void *cs_arena_alloc(size_t size);
extern void *GC_malloc(size_t size);

// Fast number-to-string with integer fast path.
// Matches JS semantics for integer-valued doubles (no trailing ".0"),
// and falls back to snprintf("%.15g") for non-integers and specials.
// Returns arena-allocated null-terminated string.
char *cs_num_to_str(double val) {
    // Fast path: integer-valued doubles in [-2^53, 2^53]. The %.15g format
    // produces pure integer text for these, so we can itoa directly.
    // Also handles -0.0 correctly (prints "0", matching JS stringification).
    if (val == 0.0) {
        char *out = (char *)cs_arena_alloc(2);
        out[0] = '0';
        out[1] = '\0';
        return out;
    }
    // Reject NaN/Infinity and non-integers via a single check.
    // Casting NaN/Inf to int64 is UB, so gate on isfinite first.
    if (__builtin_expect(isfinite(val), 1)) {
        double truncated = (double)(int64_t)val;
        if (truncated == val && val >= -9007199254740992.0 && val <= 9007199254740992.0) {
            int64_t n = (int64_t)val;
            // Up to 20 digits + sign + null.
            char buf[24];
            int pos = 23;
            buf[pos--] = '\0';
            int negative = 0;
            uint64_t u;
            if (n < 0) {
                negative = 1;
                u = (uint64_t)(-(n + 1)) + 1; // safe for INT64_MIN
            } else {
                u = (uint64_t)n;
            }
            do {
                buf[pos--] = (char)('0' + (u % 10));
                u /= 10;
            } while (u != 0);
            if (negative) buf[pos--] = '-';
            size_t start = (size_t)(pos + 1);
            size_t len = 23 - start;
            char *out = (char *)cs_arena_alloc(len + 1);
            memcpy(out, buf + start, len + 1);
            return out;
        }
    }
    // Fallback: non-integer, NaN, or Infinity.
    char tmp[48];
    int n = snprintf(tmp, sizeof(tmp), "%.15g", val);
    if (n < 0) n = 0;
    if (n >= (int)sizeof(tmp)) n = (int)sizeof(tmp) - 1;
    char *out = (char *)cs_arena_alloc((size_t)n + 1);
    memcpy(out, tmp, (size_t)n + 1);
    return out;
}

void cs_to_upper(const char *src, char *dst, size_t len) {
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)src[i];
        dst[i] = (c >= 'a' && c <= 'z') ? c - 32 : c;
    }
    dst[len] = '\0';
}

void cs_to_lower(const char *src, char *dst, size_t len) {
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)src[i];
        dst[i] = (c >= 'A' && c <= 'Z') ? c + 32 : c;
    }
    dst[len] = '\0';
}

char *cs_to_upper_alloc(const char *src) {
    size_t len = strlen(src);
    char *dst = (char *)cs_arena_alloc(len + 1);
    cs_to_upper(src, dst, len);
    return dst;
}

char *cs_to_lower_alloc(const char *src) {
    size_t len = strlen(src);
    char *dst = (char *)cs_arena_alloc(len + 1);
    cs_to_lower(src, dst, len);
    return dst;
}

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} StringArray;

char *cs_str_join_tracked(char **parts, int32_t *lengths, int32_t count,
                          const char *sep, size_t sep_len);

static char **g_cached_data = NULL;
static int32_t *g_cached_lengths = NULL;
static int32_t g_cached_count = 0;

void cs_str_cache_invalidate(void) {
    g_cached_data = NULL;
    g_cached_lengths = NULL;
    g_cached_count = 0;
}

StringArray *cs_str_split(const char *src, size_t src_len,
                          const char *sep, size_t sep_len) {
    if (sep_len == 0) {
        StringArray *arr = (StringArray *)GC_malloc(sizeof(StringArray));
        int32_t count = (int32_t)src_len;
        char **data = (char **)GC_malloc((size_t)count * sizeof(char *));
        int32_t *lens = (int32_t *)GC_malloc((size_t)count * sizeof(int32_t));
        char *buf = (char *)cs_arena_alloc(src_len * 2);
        for (int32_t i = 0; i < count; i++) {
            char *s = buf + i * 2;
            s[0] = src[i];
            s[1] = '\0';
            data[i] = s;
            lens[i] = 1;
        }
        arr->data = data;
        arr->length = count;
        arr->capacity = count;
        g_cached_data = data;
        g_cached_lengths = lens;
        g_cached_count = count;
        return arr;
    }

    int32_t part_count = 1;
    if (sep_len == 1) {
        // Fast path: single-char separator uses SIMD memchr
        const char c = sep[0];
        const char *p = src;
        const char *end = src + src_len;
        while (p < end) {
            const char *hit = (const char *)memchr(p, c, (size_t)(end - p));
            if (!hit) break;
            part_count++;
            p = hit + 1;
        }
    } else {
        size_t pos = 0;
        while (pos + sep_len <= src_len) {
            if (memcmp(src + pos, sep, sep_len) == 0) {
                part_count++;
                pos += sep_len;
            } else {
                pos++;
            }
        }
    }

    StringArray *arr = (StringArray *)GC_malloc(sizeof(StringArray));
    char **data = (char **)GC_malloc((size_t)part_count * sizeof(char *));
    int32_t *lens = (int32_t *)GC_malloc((size_t)part_count * sizeof(int32_t));

    size_t total_str_bytes = src_len + (size_t)part_count;
    char *pool = (char *)cs_arena_alloc(total_str_bytes);
    size_t pool_off = 0;

    int32_t idx = 0;
    size_t start = 0;
    if (sep_len == 1) {
        // Fast path: single-char separator uses SIMD memchr
        const char c = sep[0];
        const char *p = src;
        const char *end = src + src_len;
        while (p < end) {
            const char *hit = (const char *)memchr(p, c, (size_t)(end - p));
            if (!hit) break;
            size_t plen = (size_t)(hit - (src + start));
            char *s = pool + pool_off;
            memcpy(s, src + start, plen);
            s[plen] = '\0';
            pool_off += plen + 1;
            data[idx] = s;
            lens[idx] = (int32_t)plen;
            idx++;
            start = (size_t)(hit - src) + 1;
            p = hit + 1;
        }
    } else {
        size_t pos = 0;
        while (pos + sep_len <= src_len) {
            if (memcmp(src + pos, sep, sep_len) == 0) {
                size_t plen = pos - start;
                char *s = pool + pool_off;
                memcpy(s, src + start, plen);
                s[plen] = '\0';
                pool_off += plen + 1;
                data[idx] = s;
                lens[idx] = (int32_t)plen;
                idx++;
                start = pos + sep_len;
                pos = start;
            } else {
                pos++;
            }
        }
    }
    size_t plen = src_len - start;
    char *s = pool + pool_off;
    memcpy(s, src + start, plen);
    s[plen] = '\0';
    data[idx] = s;
    lens[idx] = (int32_t)plen;

    arr->data = data;
    arr->length = part_count;
    arr->capacity = part_count;
    g_cached_data = data;
    g_cached_lengths = lens;
    g_cached_count = part_count;
    return arr;
}

char *cs_str_join(char **parts, int32_t count, const char *sep, size_t sep_len) {
    if (count == 0) {
        char *empty = (char *)cs_arena_alloc(1);
        empty[0] = '\0';
        return empty;
    }

    size_t total = 0;
    for (int32_t i = 0; i < count; i++) {
        if (parts[i]) total += strlen(parts[i]);
    }
    total += (size_t)(count - 1) * sep_len;

    char *result = (char *)cs_arena_alloc(total + 1);
    size_t off = 0;
    for (int32_t i = 0; i < count; i++) {
        if (i > 0 && sep_len > 0) {
            memcpy(result + off, sep, sep_len);
            off += sep_len;
        }
        if (parts[i]) {
            size_t len = strlen(parts[i]);
            memcpy(result + off, parts[i], len);
            off += len;
        }
    }
    result[off] = '\0';
    return result;
}

char *cs_str_join_tracked(char **parts, int32_t *lengths, int32_t count,
                          const char *sep, size_t sep_len) {
    if (count == 0) {
        char *empty = (char *)cs_arena_alloc(1);
        empty[0] = '\0';
        return empty;
    }

    size_t total = 0;
    for (int32_t i = 0; i < count; i++) {
        total += (size_t)lengths[i];
    }
    total += (size_t)(count - 1) * sep_len;

    char *result = (char *)cs_arena_alloc(total + 1);
    size_t off = 0;
    for (int32_t i = 0; i < count; i++) {
        if (i > 0 && sep_len > 0) {
            memcpy(result + off, sep, sep_len);
            off += sep_len;
        }
        size_t len = (size_t)lengths[i];
        memcpy(result + off, parts[i], len);
        off += len;
    }
    result[off] = '\0';
    return result;
}

StringArray *cs_str_array_to_upper(StringArray *input) {
    int32_t count = input->length;
    StringArray *out = (StringArray *)GC_malloc(sizeof(StringArray));
    char **data = (char **)GC_malloc((size_t)count * sizeof(char *));
    int32_t *lens = (int32_t *)GC_malloc((size_t)count * sizeof(int32_t));

    size_t total_bytes = 0;
    int32_t *src_lens = (input->data == g_cached_data && g_cached_count == count) ? g_cached_lengths : NULL;
    if (src_lens) {
        for (int32_t i = 0; i < count; i++)
            total_bytes += (size_t)src_lens[i] + 1;
    } else {
        for (int32_t i = 0; i < count; i++)
            total_bytes += strlen(input->data[i]) + 1;
    }

    char *pool = (char *)cs_arena_alloc(total_bytes);
    size_t pool_off = 0;

    for (int32_t i = 0; i < count; i++) {
        size_t len = src_lens ? (size_t)src_lens[i] : strlen(input->data[i]);
        char *dst = pool + pool_off;
        cs_to_upper(input->data[i], dst, len);
        data[i] = dst;
        lens[i] = (int32_t)len;
        pool_off += len + 1;
    }

    out->data = data;
    out->length = count;
    out->capacity = count;
    g_cached_data = data;
    g_cached_lengths = lens;
    g_cached_count = count;
    return out;
}

StringArray *cs_str_array_to_lower(StringArray *input) {
    int32_t count = input->length;
    StringArray *out = (StringArray *)GC_malloc(sizeof(StringArray));
    char **data = (char **)GC_malloc((size_t)count * sizeof(char *));
    int32_t *lens = (int32_t *)GC_malloc((size_t)count * sizeof(int32_t));

    size_t total_bytes = 0;
    int32_t *src_lens = (input->data == g_cached_data && g_cached_count == count) ? g_cached_lengths : NULL;
    if (src_lens) {
        for (int32_t i = 0; i < count; i++)
            total_bytes += (size_t)src_lens[i] + 1;
    } else {
        for (int32_t i = 0; i < count; i++)
            total_bytes += strlen(input->data[i]) + 1;
    }

    char *pool = (char *)cs_arena_alloc(total_bytes);
    size_t pool_off = 0;

    for (int32_t i = 0; i < count; i++) {
        size_t len = src_lens ? (size_t)src_lens[i] : strlen(input->data[i]);
        char *dst = pool + pool_off;
        cs_to_lower(input->data[i], dst, len);
        data[i] = dst;
        lens[i] = (int32_t)len;
        pool_off += len + 1;
    }

    out->data = data;
    out->length = count;
    out->capacity = count;
    g_cached_data = data;
    g_cached_lengths = lens;
    g_cached_count = count;
    return out;
}
