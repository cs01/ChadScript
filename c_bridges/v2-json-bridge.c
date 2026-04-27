#include "yyjson.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <math.h>

#define TAG_UNDEFINED 0x7FFC000000000001ULL
#define TAG_NULL      0x7FFC000000000002ULL
#define TAG_FALSE     0x7FFC000000000003ULL
#define TAG_TRUE      0x7FFC000000000004ULL
#define TAG_PTR       0x7FFD000000000000ULL
#define TAG_INT       0x7FFE000000000000ULL
#define TAG_STRING    0x7FFF000000000000ULL

#define MASK_QUIET    0x7FFC000000000000ULL
#define MASK_PAYLOAD  0x0000FFFFFFFFFFFFULL

extern uint64_t nanbox_from_f64(double val);
extern uint64_t nanbox_from_string(const char *s);
extern uint64_t nanbox_from_bool(int val);
extern uint64_t nanbox_null(void);
extern double nanbox_to_f64(uint64_t v);
extern const char *nanbox_to_string(uint64_t v);
extern int64_t nanbox_to_i64(uint64_t v);
extern void cs2_format_number(char *out, double val);

typedef struct {
    double *data;
    int32_t length;
    int32_t capacity;
} NumArray;

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} StrArray;

static char *strdup_safe(const char *s) {
    size_t len = strlen(s);
    char *r = (char *)malloc(len + 1);
    memcpy(r, s, len + 1);
    return r;
}

char *cs2_json_stringify_f64(double val) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    if (val == (double)(int64_t)val && val >= -9007199254740992.0 && val <= 9007199254740992.0) {
        yyjson_mut_doc_set_root(doc, yyjson_mut_int(doc, (int64_t)val));
    } else {
        yyjson_mut_doc_set_root(doc, yyjson_mut_real(doc, val));
    }
    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
}

char *cs2_json_stringify_i64(int64_t val) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_doc_set_root(doc, yyjson_mut_int(doc, val));
    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
}

char *cs2_json_stringify_str(const char *val) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_doc_set_root(doc, yyjson_mut_str(doc, val));
    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
}

char *cs2_json_stringify_bool(int val) {
    return strdup_safe(val ? "true" : "false");
}

char *cs2_json_stringify_null(void) {
    return strdup_safe("null");
}

char *cs2_json_stringify_boxed(uint64_t v) {
    if (v == TAG_NULL) return strdup_safe("null");
    if (v == TAG_UNDEFINED) return strdup_safe("undefined");
    if (v == TAG_TRUE) return strdup_safe("true");
    if (v == TAG_FALSE) return strdup_safe("false");

    if ((v & 0xFFFF000000000000ULL) == TAG_STRING) {
        return cs2_json_stringify_str(nanbox_to_string(v));
    }

    if ((v & 0xFFFF000000000000ULL) == TAG_INT) {
        return cs2_json_stringify_i64(nanbox_to_i64(v));
    }

    if ((v & MASK_QUIET) != MASK_QUIET) {
        return cs2_json_stringify_f64(nanbox_to_f64(v));
    }

    return strdup_safe("null");
}

char *cs2_json_stringify_num_array(void *arr) {
    NumArray *na = (NumArray *)arr;
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_arr(doc);
    yyjson_mut_doc_set_root(doc, root);

    for (int32_t i = 0; i < na->length; i++) {
        double val = na->data[i];
        if (val == (double)(int64_t)val && val >= -9007199254740992.0 && val <= 9007199254740992.0) {
            yyjson_mut_arr_add_int(doc, root, (int64_t)val);
        } else {
            yyjson_mut_arr_add_real(doc, root, val);
        }
    }

    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
}

char *cs2_json_stringify_str_array(void *arr) {
    StrArray *sa = (StrArray *)arr;
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_arr(doc);
    yyjson_mut_doc_set_root(doc, root);

    for (int32_t i = 0; i < sa->length; i++) {
        yyjson_mut_arr_add_str(doc, root, sa->data[i]);
    }

    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
}

int64_t cs2_json_parse(const char *str) {
    if (!str) return (int64_t)TAG_NULL;
    yyjson_doc *doc = yyjson_read(str, strlen(str), 0);
    if (!doc) return (int64_t)TAG_NULL;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (!root) { yyjson_doc_free(doc); return (int64_t)TAG_NULL; }

    int64_t result;
    if (yyjson_is_real(root)) {
        result = (int64_t)nanbox_from_f64(yyjson_get_real(root));
    } else if (yyjson_is_int(root)) {
        result = (int64_t)nanbox_from_f64((double)yyjson_get_sint(root));
    } else if (yyjson_is_str(root)) {
        const char *s = yyjson_get_str(root);
        result = (int64_t)nanbox_from_string(strdup_safe(s));
    } else if (yyjson_is_true(root)) {
        result = (int64_t)nanbox_from_bool(1);
    } else if (yyjson_is_false(root)) {
        result = (int64_t)nanbox_from_bool(0);
    } else if (yyjson_is_null(root)) {
        result = (int64_t)TAG_NULL;
    } else {
        result = (int64_t)TAG_NULL;
    }

    yyjson_doc_free(doc);
    return result;
}
