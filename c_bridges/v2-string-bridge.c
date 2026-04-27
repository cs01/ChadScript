#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdio.h>

int32_t cs2_str_length(const char *s) {
    return (int32_t)strlen(s);
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

double cs2_math_random(void) {
    static int seeded = 0;
    if (!seeded) { srand(42); seeded = 1; }
    return (double)rand() / (double)RAND_MAX;
}

static void cs2_shortest_repr(char *buf, int bufsz, double val) {
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
