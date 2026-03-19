#include <stddef.h>
#include <stdint.h>
#include <string.h>

extern void *cs_arena_alloc(size_t size);
extern void *GC_malloc(size_t size);

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

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} StringArray;

StringArray *cs_str_split(const char *src, size_t src_len,
                          const char *sep, size_t sep_len) {
    if (sep_len == 0) {
        StringArray *arr = (StringArray *)GC_malloc(sizeof(StringArray));
        int32_t count = (int32_t)src_len;
        char **data = (char **)GC_malloc((size_t)count * sizeof(char *));
        char *buf = (char *)cs_arena_alloc(src_len * 2);
        for (int32_t i = 0; i < count; i++) {
            char *s = buf + i * 2;
            s[0] = src[i];
            s[1] = '\0';
            data[i] = s;
        }
        arr->data = data;
        arr->length = count;
        arr->capacity = count;
        return arr;
    }

    int32_t part_count = 1;
    size_t pos = 0;
    while (pos + sep_len <= src_len) {
        if (memcmp(src + pos, sep, sep_len) == 0) {
            part_count++;
            pos += sep_len;
        } else {
            pos++;
        }
    }

    StringArray *arr = (StringArray *)GC_malloc(sizeof(StringArray));
    char **data = (char **)GC_malloc((size_t)part_count * sizeof(char *));

    size_t total_str_bytes = src_len + (size_t)part_count;
    char *pool = (char *)cs_arena_alloc(total_str_bytes);
    size_t pool_off = 0;

    int32_t idx = 0;
    size_t start = 0;
    pos = 0;
    while (pos + sep_len <= src_len) {
        if (memcmp(src + pos, sep, sep_len) == 0) {
            size_t plen = pos - start;
            char *s = pool + pool_off;
            memcpy(s, src + start, plen);
            s[plen] = '\0';
            pool_off += plen + 1;
            data[idx++] = s;
            start = pos + sep_len;
            pos = start;
        } else {
            pos++;
        }
    }
    size_t plen = src_len - start;
    char *s = pool + pool_off;
    memcpy(s, src + start, plen);
    s[plen] = '\0';
    data[idx] = s;

    arr->data = data;
    arr->length = part_count;
    arr->capacity = part_count;
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
