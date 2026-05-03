#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdio.h>
#include <stdint.h>

int32_t cs2_str_length(const char *s) {
    if (!s) return 0;
    return (int32_t)strlen(s);
}

char *cs2_str_at(const char *s, int32_t idx) {
    int32_t len = (int32_t)strlen(s);
    if (idx < 0) idx += len;
    if (idx < 0 || idx >= len) {
        char *empty = (char *)malloc(1);
        empty[0] = '\0';
        return empty;
    }
    char *result = (char *)malloc(2);
    result[0] = s[idx];
    result[1] = '\0';
    return result;
}

char *cs2_str_char_at(const char *s, int32_t idx) {
    int32_t len = (int32_t)strlen(s);
    if (idx < 0 || idx >= len) {
        char *empty = (char *)malloc(1);
        empty[0] = '\0';
        return empty;
    }
    char *result = (char *)malloc(2);
    result[0] = s[idx];
    result[1] = '\0';
    return result;
}

int32_t cs2_str_index_of(const char *haystack, const char *needle) {
    const char *found = strstr(haystack, needle);
    if (!found) return -1;
    return (int32_t)(found - haystack);
}

int32_t cs2_str_includes(const char *haystack, const char *needle) {
    return strstr(haystack, needle) != NULL ? 1 : 0;
}

int32_t cs2_str_starts_with(const char *s, const char *prefix) {
    size_t plen = strlen(prefix);
    return strncmp(s, prefix, plen) == 0 ? 1 : 0;
}

int32_t cs2_str_ends_with(const char *s, const char *suffix) {
    size_t slen = strlen(s);
    size_t xlen = strlen(suffix);
    if (xlen > slen) return 0;
    return strcmp(s + slen - xlen, suffix) == 0 ? 1 : 0;
}

char *cs2_str_slice(const char *s, int32_t start, int32_t end) {
    int32_t len = (int32_t)strlen(s);
    if (start < 0) start = len + start;
    if (end < 0) end = len + end;
    if (start < 0) start = 0;
    if (end > len) end = len;
    if (start >= end) {
        char *empty = (char *)malloc(1);
        empty[0] = '\0';
        return empty;
    }
    int32_t rlen = end - start;
    char *result = (char *)malloc(rlen + 1);
    memcpy(result, s + start, rlen);
    result[rlen] = '\0';
    return result;
}

char *cs2_str_substring(const char *s, int32_t start, int32_t end) {
    int32_t len = (int32_t)strlen(s);
    if (start < 0) start = 0;
    if (end < 0) end = 0;
    if (start > len) start = len;
    if (end > len) end = len;
    if (start > end) { int32_t t = start; start = end; end = t; }
    int32_t rlen = end - start;
    char *result = (char *)malloc(rlen + 1);
    memcpy(result, s + start, rlen);
    result[rlen] = '\0';
    return result;
}

char *cs2_str_to_upper(const char *s) {
    size_t len = strlen(s);
    char *result = (char *)malloc(len + 1);
    for (size_t i = 0; i < len; i++) {
        result[i] = (char)toupper((unsigned char)s[i]);
    }
    result[len] = '\0';
    return result;
}

char *cs2_str_to_lower(const char *s) {
    size_t len = strlen(s);
    char *result = (char *)malloc(len + 1);
    for (size_t i = 0; i < len; i++) {
        result[i] = (char)tolower((unsigned char)s[i]);
    }
    result[len] = '\0';
    return result;
}

char *cs2_str_trim(const char *s) {
    size_t len = strlen(s);
    size_t start = 0;
    while (start < len && isspace((unsigned char)s[start])) start++;
    size_t end = len;
    while (end > start && isspace((unsigned char)s[end - 1])) end--;
    size_t rlen = end - start;
    char *result = (char *)malloc(rlen + 1);
    memcpy(result, s + start, rlen);
    result[rlen] = '\0';
    return result;
}

char *cs2_str_repeat(const char *s, int32_t count) {
    if (count <= 0) {
        char *empty = (char *)malloc(1);
        empty[0] = '\0';
        return empty;
    }
    size_t len = strlen(s);
    size_t total = len * count;
    char *result = (char *)malloc(total + 1);
    for (int32_t i = 0; i < count; i++) {
        memcpy(result + i * len, s, len);
    }
    result[total] = '\0';
    return result;
}

char *cs2_str_replace(const char *s, const char *search, const char *replace) {
    const char *found = strstr(s, search);
    if (!found) {
        char *copy = (char *)malloc(strlen(s) + 1);
        strcpy(copy, s);
        return copy;
    }
    size_t prefix_len = found - s;
    size_t search_len = strlen(search);
    size_t replace_len = strlen(replace);
    size_t suffix_len = strlen(found + search_len);
    size_t total = prefix_len + replace_len + suffix_len;
    char *result = (char *)malloc(total + 1);
    memcpy(result, s, prefix_len);
    memcpy(result + prefix_len, replace, replace_len);
    memcpy(result + prefix_len + replace_len, found + search_len, suffix_len);
    result[total] = '\0';
    return result;
}

int32_t cs2_str_char_code_at(const char *s, int32_t idx) {
    int32_t len = (int32_t)strlen(s);
    if (idx < 0 || idx >= len) return -1;
    return (int32_t)(unsigned char)s[idx];
}

char *cs2_str_from_char_code(int32_t code) {
    char *result = (char *)malloc(2);
    result[0] = (char)code;
    result[1] = '\0';
    return result;
}

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} CS2StrArray;

CS2StrArray *cs2_str_split(const char *s, const char *sep) {
    CS2StrArray *arr = (CS2StrArray *)malloc(sizeof(CS2StrArray));
    arr->capacity = 8;
    arr->data = (char **)malloc(sizeof(char *) * arr->capacity);
    arr->length = 0;

    size_t sep_len = strlen(sep);
    if (sep_len == 0) {
        size_t len = strlen(s);
        for (size_t i = 0; i < len; i++) {
            if (arr->length >= arr->capacity) {
                arr->capacity *= 2;
                arr->data = (char **)realloc(arr->data, sizeof(char *) * arr->capacity);
            }
            char *ch = (char *)malloc(2);
            ch[0] = s[i];
            ch[1] = '\0';
            arr->data[arr->length++] = ch;
        }
        return arr;
    }

    const char *start = s;
    const char *found;
    while ((found = strstr(start, sep)) != NULL) {
        if (arr->length >= arr->capacity) {
            arr->capacity *= 2;
            arr->data = (char **)realloc(arr->data, sizeof(char *) * arr->capacity);
        }
        size_t part_len = found - start;
        char *part = (char *)malloc(part_len + 1);
        memcpy(part, start, part_len);
        part[part_len] = '\0';
        arr->data[arr->length++] = part;
        start = found + sep_len;
    }
    if (arr->length >= arr->capacity) {
        arr->capacity *= 2;
        arr->data = (char **)realloc(arr->data, sizeof(char *) * arr->capacity);
    }
    size_t rest_len = strlen(start);
    char *rest = (char *)malloc(rest_len + 1);
    memcpy(rest, start, rest_len + 1);
    arr->data[arr->length++] = rest;
    return arr;
}

char *cs2_str_pad_start(const char *s, int32_t target_len, const char *pad) {
    int32_t len = (int32_t)strlen(s);
    if (len >= target_len) {
        char *copy = (char *)malloc(len + 1);
        memcpy(copy, s, len + 1);
        return copy;
    }
    int32_t pad_needed = target_len - len;
    size_t pad_len = strlen(pad);
    if (pad_len == 0) pad_len = 1;
    char *result = (char *)malloc(target_len + 1);
    for (int32_t i = 0; i < pad_needed; i++) {
        result[i] = pad[i % pad_len];
    }
    memcpy(result + pad_needed, s, len + 1);
    return result;
}

char *cs2_str_pad_end(const char *s, int32_t target_len, const char *pad) {
    int32_t len = (int32_t)strlen(s);
    if (len >= target_len) {
        char *copy = (char *)malloc(len + 1);
        memcpy(copy, s, len + 1);
        return copy;
    }
    int32_t pad_needed = target_len - len;
    size_t pad_len = strlen(pad);
    if (pad_len == 0) pad_len = 1;
    char *result = (char *)malloc(target_len + 1);
    memcpy(result, s, len);
    for (int32_t i = 0; i < pad_needed; i++) {
        result[len + i] = pad[i % pad_len];
    }
    result[target_len] = '\0';
    return result;
}

char *cs2_str_trim_start(const char *s) {
    while (*s && isspace((unsigned char)*s)) s++;
    size_t len = strlen(s);
    char *result = (char *)malloc(len + 1);
    memcpy(result, s, len + 1);
    return result;
}

char *cs2_str_trim_end(const char *s) {
    size_t len = strlen(s);
    while (len > 0 && isspace((unsigned char)s[len - 1])) len--;
    char *result = (char *)malloc(len + 1);
    memcpy(result, s, len);
    result[len] = '\0';
    return result;
}

double cs2_parse_float(const char *s) {
    return atof(s);
}

double cs2_parse_int(const char *s) {
    return (double)atoi(s);
}

int32_t cs2_number_is_integer(double val) {
    return val == (double)(long long)val && val >= -9007199254740992.0 && val <= 9007199254740992.0;
}

int32_t cs2_number_is_nan(double val) {
    return val != val;
}

int32_t cs2_number_is_finite(double val) {
    return val == val && val != 1.0/0.0 && val != -1.0/0.0;
}

double cs2_math_random(void) {
    static int seeded = 0;
    if (!seeded) { srand(42); seeded = 1; }
    return (double)rand() / (double)RAND_MAX;
}

static void cs2_shortest_repr(char *buf, int bufsz, double val) {
    if (val != val) { snprintf(buf, bufsz, "NaN"); return; }
    if (val == 1.0/0.0) { snprintf(buf, bufsz, "Infinity"); return; }
    if (val == -1.0/0.0) { snprintf(buf, bufsz, "-Infinity"); return; }
    for (int prec = 1; prec <= 21; prec++) {
        snprintf(buf, bufsz, "%.*g", prec, val);
        double reparsed;
        sscanf(buf, "%lf", &reparsed);
        if (reparsed == val) {
            if (strchr(buf, 'e') || strchr(buf, 'E')) {
                char alt[32];
                if (val == (long long)val && val >= -1e15 && val <= 1e15) {
                    snprintf(alt, sizeof(alt), "%.0f", val);
                    double re2;
                    sscanf(alt, "%lf", &re2);
                    if (re2 == val) {
                        memcpy(buf, alt, strlen(alt) + 1);
                        return;
                    }
                }
            }
            return;
        }
    }
    snprintf(buf, bufsz, "%.17g", val);
}

void cs2_print_number(double val) {
    char buf[32];
    cs2_shortest_repr(buf, sizeof(buf), val);
    printf("%s", buf);
}

void cs2_format_number(char *out, double val) {
    cs2_shortest_repr(out, 32, val);
}

char *cs2_number_to_string(double val) {
    char *buf = (char *)malloc(32);
    cs2_shortest_repr(buf, 32, val);
    return buf;
}

char *cs2_number_to_fixed(double val, double digits) {
    int d = (int)digits;
    if (d < 0) d = 0;
    if (d > 20) d = 20;
    char *buf = (char *)malloc(64);
    snprintf(buf, 64, "%.*f", d, val);
    return buf;
}

double cs2_str_last_index_of(const char *s, const char *search) {
    size_t slen = strlen(s);
    size_t searchlen = strlen(search);
    if (searchlen > slen) return -1.0;
    for (size_t i = slen - searchlen + 1; i > 0; i--) {
        if (memcmp(s + i - 1, search, searchlen) == 0) return (double)(i - 1);
    }
    return -1.0;
}

char *cs2_str_replace_all(const char *s, const char *search, const char *replace) {
    size_t slen = strlen(s);
    size_t searchlen = strlen(search);
    size_t replacelen = strlen(replace);
    if (searchlen == 0) {
        char *copy = (char *)malloc(slen + 1);
        memcpy(copy, s, slen + 1);
        return copy;
    }
    size_t count = 0;
    const char *p = s;
    while ((p = strstr(p, search)) != NULL) { count++; p += searchlen; }
    size_t newlen = slen + count * (replacelen - searchlen);
    char *result = (char *)malloc(newlen + 1);
    char *dst = result;
    p = s;
    while (1) {
        const char *found = strstr(p, search);
        if (!found) {
            strcpy(dst, p);
            break;
        }
        size_t chunk = found - p;
        memcpy(dst, p, chunk);
        dst += chunk;
        memcpy(dst, replace, replacelen);
        dst += replacelen;
        p = found + searchlen;
    }
    return result;
}

typedef struct {
    uint64_t magic;
    size_t len;
    size_t cap;
} CsStrHdr;

#define CS_STR_BUILDER_MAGIC 0xC4AD5712C0DE0001ULL

char *cs2_string_builder_init(const char *initial) {
    size_t init_len = initial ? strlen(initial) : 0;
    size_t cap = init_len < 16 ? 16 : init_len * 2;
    CsStrHdr *h = (CsStrHdr *)malloc(sizeof(CsStrHdr) + cap + 1);
    h->magic = CS_STR_BUILDER_MAGIC;
    h->len = init_len;
    h->cap = cap;
    char *buf = (char *)(h + 1);
    if (init_len) memcpy(buf, initial, init_len);
    buf[init_len] = '\0';
    return buf;
}

char *cs2_string_builder_append(char *left, const char *right) {
    if (!right) return left;
    CsStrHdr *h = (CsStrHdr *)left - 1;
    if (h->magic != CS_STR_BUILDER_MAGIC) {
        char *fresh = cs2_string_builder_init(left);
        return cs2_string_builder_append(fresh, right);
    }
    size_t rlen = strlen(right);
    size_t needed = h->len + rlen;
    if (needed >= h->cap) {
        size_t newcap = h->cap;
        while (newcap <= needed) newcap *= 2;
        h = (CsStrHdr *)realloc(h, sizeof(CsStrHdr) + newcap + 1);
        h->cap = newcap;
        left = (char *)(h + 1);
    }
    memcpy(left + h->len, right, rlen);
    h->len += rlen;
    left[h->len] = '\0';
    return left;
}
