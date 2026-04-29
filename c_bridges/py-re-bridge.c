#define PCRE2_CODE_UNIT_WIDTH 8
#include <pcre2.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>

typedef struct { char **data; int32_t length; int32_t capacity; } StrArray;
extern StrArray *cs2_str_array_new(int32_t capacity);
extern void cs2_str_array_push(StrArray *arr, const char *s);

typedef struct {
    char *subject;
    int32_t *ovector;
    int32_t num_groups;
    int32_t start;
    int32_t end;
} CS2ReMatch;

static CS2ReMatch *do_match(const char *pattern, const char *subject, int anchored) {
    int errcode;
    PCRE2_SIZE erroffset;
    uint32_t flags = anchored ? PCRE2_ANCHORED : 0;
    pcre2_code *re = pcre2_compile((PCRE2_SPTR)pattern, PCRE2_ZERO_TERMINATED, flags, &errcode, &erroffset, NULL);
    if (!re) return NULL;

    uint32_t capturecount;
    pcre2_pattern_info(re, PCRE2_INFO_CAPTURECOUNT, &capturecount);

    pcre2_match_data *md = pcre2_match_data_create_from_pattern(re, NULL);
    int rc = pcre2_match(re, (PCRE2_SPTR)subject, PCRE2_ZERO_TERMINATED, 0, 0, md, NULL);
    if (rc <= 0) {
        pcre2_match_data_free(md);
        pcre2_code_free(re);
        return NULL;
    }

    PCRE2_SIZE *ov = pcre2_get_ovector_pointer(md);
    CS2ReMatch *m = (CS2ReMatch *)malloc(sizeof(CS2ReMatch));
    m->subject = strdup(subject);
    m->num_groups = (int32_t)capturecount;
    m->start = (int32_t)ov[0];
    m->end = (int32_t)ov[1];
    m->ovector = (int32_t *)malloc(sizeof(int32_t) * 2 * (capturecount + 1));
    for (uint32_t i = 0; i <= capturecount; i++) {
        m->ovector[2*i]   = (ov[2*i]   == PCRE2_UNSET) ? -1 : (int32_t)ov[2*i];
        m->ovector[2*i+1] = (ov[2*i+1] == PCRE2_UNSET) ? -1 : (int32_t)ov[2*i+1];
    }

    pcre2_match_data_free(md);
    pcre2_code_free(re);
    return m;
}

CS2ReMatch *cs2_re_match(const char *pattern, const char *subject) {
    return do_match(pattern, subject, 1);
}

CS2ReMatch *cs2_re_search(const char *pattern, const char *subject) {
    return do_match(pattern, subject, 0);
}

char *cs2_re_match_group(CS2ReMatch *m, int32_t n) {
    if (!m || n > m->num_groups) return "";
    int32_t s = m->ovector[2*n];
    int32_t e = m->ovector[2*n+1];
    if (s < 0) return "";
    int32_t len = e - s;
    char *buf = (char *)malloc(len + 1);
    memcpy(buf, m->subject + s, len);
    buf[len] = '\0';
    return buf;
}

int32_t cs2_re_match_start(CS2ReMatch *m) { return m ? m->start : -1; }
int32_t cs2_re_match_end(CS2ReMatch *m) { return m ? m->end : -1; }

StrArray *cs2_re_findall(const char *pattern, const char *subject) {
    StrArray *arr = cs2_str_array_new(8);
    int errcode;
    PCRE2_SIZE erroffset;
    pcre2_code *re = pcre2_compile((PCRE2_SPTR)pattern, PCRE2_ZERO_TERMINATED, 0, &errcode, &erroffset, NULL);
    if (!re) return arr;

    uint32_t capturecount;
    pcre2_pattern_info(re, PCRE2_INFO_CAPTURECOUNT, &capturecount);

    pcre2_match_data *md = pcre2_match_data_create_from_pattern(re, NULL);
    size_t offset = 0;
    size_t subj_len = strlen(subject);

    while (offset <= subj_len) {
        int rc = pcre2_match(re, (PCRE2_SPTR)subject, subj_len, offset, 0, md, NULL);
        if (rc <= 0) break;
        PCRE2_SIZE *ov = pcre2_get_ovector_pointer(md);
        if (capturecount == 0) {
            int32_t s = (int32_t)ov[0], e = (int32_t)ov[1];
            char *buf = (char *)malloc(e - s + 1);
            memcpy(buf, subject + s, e - s);
            buf[e - s] = '\0';
            cs2_str_array_push(arr, buf);
        } else {
            for (uint32_t g = 1; g <= capturecount; g++) {
                if (ov[2*g] == PCRE2_UNSET) { cs2_str_array_push(arr, ""); continue; }
                int32_t s = (int32_t)ov[2*g], e = (int32_t)ov[2*g+1];
                char *buf = (char *)malloc(e - s + 1);
                memcpy(buf, subject + s, e - s);
                buf[e - s] = '\0';
                cs2_str_array_push(arr, buf);
            }
        }
        offset = ov[1] > ov[0] ? ov[1] : ov[1] + 1;
    }

    pcre2_match_data_free(md);
    pcre2_code_free(re);
    return arr;
}

char *cs2_re_sub(const char *pattern, const char *repl, const char *subject) {
    int errcode;
    PCRE2_SIZE erroffset;
    pcre2_code *re = pcre2_compile((PCRE2_SPTR)pattern, PCRE2_ZERO_TERMINATED, 0, &errcode, &erroffset, NULL);
    if (!re) return strdup(subject);

    size_t subj_len = strlen(subject);
    size_t repl_len = strlen(repl);
    pcre2_match_data *md = pcre2_match_data_create_from_pattern(re, NULL);

    char *out = (char *)malloc(subj_len * 2 + repl_len * 4 + 8);
    size_t out_pos = 0;
    size_t offset = 0;

    while (offset <= subj_len) {
        int rc = pcre2_match(re, (PCRE2_SPTR)subject, subj_len, offset, 0, md, NULL);
        if (rc <= 0) break;
        PCRE2_SIZE *ov = pcre2_get_ovector_pointer(md);
        size_t s = ov[0], e = ov[1];
        memcpy(out + out_pos, subject + offset, s - offset);
        out_pos += s - offset;
        memcpy(out + out_pos, repl, repl_len);
        out_pos += repl_len;
        offset = e > s ? e : e + 1;
    }
    memcpy(out + out_pos, subject + offset, subj_len - offset);
    out_pos += subj_len - offset;
    out[out_pos] = '\0';

    pcre2_match_data_free(md);
    pcre2_code_free(re);
    return out;
}

StrArray *cs2_re_split(const char *pattern, const char *subject) {
    StrArray *arr = cs2_str_array_new(8);
    int errcode;
    PCRE2_SIZE erroffset;
    pcre2_code *re = pcre2_compile((PCRE2_SPTR)pattern, PCRE2_ZERO_TERMINATED, 0, &errcode, &erroffset, NULL);
    if (!re) { cs2_str_array_push(arr, strdup(subject)); return arr; }

    size_t subj_len = strlen(subject);
    pcre2_match_data *md = pcre2_match_data_create_from_pattern(re, NULL);
    size_t offset = 0;

    while (offset <= subj_len) {
        int rc = pcre2_match(re, (PCRE2_SPTR)subject, subj_len, offset, 0, md, NULL);
        if (rc <= 0) break;
        PCRE2_SIZE *ov = pcre2_get_ovector_pointer(md);
        size_t s = ov[0], e = ov[1];
        size_t chunk_len = s - offset;
        char *chunk = (char *)malloc(chunk_len + 1);
        memcpy(chunk, subject + offset, chunk_len);
        chunk[chunk_len] = '\0';
        cs2_str_array_push(arr, chunk);
        offset = e > s ? e : e + 1;
    }
    cs2_str_array_push(arr, strdup(subject + offset));
    pcre2_match_data_free(md);
    pcre2_code_free(re);
    return arr;
}
