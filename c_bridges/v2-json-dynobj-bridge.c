#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>
#include "../vendor/yyjson/yyjson.h"

#define TAG_F64    0
#define TAG_STRING 1
#define TAG_BOOL   2
#define TAG_NULL   3
#define TAG_OBJECT 4
#define TAG_ARRAY  5

typedef struct {
    int32_t tag;
    union {
        double f64_val;
        char *str_val;
        int32_t bool_val;
        void *obj_val;
        void *arr_val;
    };
} DynValue;

typedef struct {
    char **keys;
    DynValue *values;
    int32_t length;
    int32_t capacity;
} DynObj;

typedef struct {
    DynValue *data;
    int32_t length;
    int32_t capacity;
} DynArray;

extern DynObj *cs2_dynobj_new(void);
extern void cs2_dynobj_set_f64(DynObj *o, const char *key, double val);
extern void cs2_dynobj_set_str(DynObj *o, const char *key, const char *val);
extern void cs2_dynobj_set_bool(DynObj *o, const char *key, int32_t val);
extern void cs2_dynobj_set_null(DynObj *o, const char *key);
extern void cs2_dynobj_set_obj(DynObj *o, const char *key, DynObj *val);
extern void cs2_dynobj_set_arr(DynObj *o, const char *key, DynArray *val);

extern DynArray *cs2_dynarray_new(void);
extern void cs2_dynarray_push_f64(DynArray *a, double val);
extern void cs2_dynarray_push_str(DynArray *a, const char *val);
extern void cs2_dynarray_push_obj(DynArray *a, DynObj *val);
extern void cs2_dynarray_push_arr(DynArray *a, DynArray *val);
extern void cs2_dynarray_push_null(DynArray *a);
extern void cs2_dynarray_push_bool(DynArray *a, int32_t val);

static char *strdup_safe(const char *s) {
    if (!s) return NULL;
    size_t len = strlen(s) + 1;
    char *d = (char *)malloc(len);
    memcpy(d, s, len);
    return d;
}

static DynObj *convert_obj(yyjson_val *obj);
static DynArray *convert_arr(yyjson_val *arr);

static DynObj *convert_obj(yyjson_val *obj) {
    DynObj *o = cs2_dynobj_new();
    yyjson_obj_iter iter;
    yyjson_obj_iter_init(obj, &iter);
    yyjson_val *key, *val;
    while ((key = yyjson_obj_iter_next(&iter))) {
        val = yyjson_obj_iter_get_val(key);
        const char *k = strdup_safe(yyjson_get_str(key));
        if (yyjson_is_real(val) || yyjson_is_int(val)) {
            double v = yyjson_is_real(val) ? yyjson_get_real(val) : (double)yyjson_get_sint(val);
            cs2_dynobj_set_f64(o, k, v);
        } else if (yyjson_is_str(val)) {
            cs2_dynobj_set_str(o, k, strdup_safe(yyjson_get_str(val)));
        } else if (yyjson_is_true(val)) {
            cs2_dynobj_set_bool(o, k, 1);
        } else if (yyjson_is_false(val)) {
            cs2_dynobj_set_bool(o, k, 0);
        } else if (yyjson_is_null(val)) {
            cs2_dynobj_set_null(o, k);
        } else if (yyjson_is_obj(val)) {
            cs2_dynobj_set_obj(o, k, convert_obj(val));
        } else if (yyjson_is_arr(val)) {
            cs2_dynobj_set_arr(o, k, convert_arr(val));
        }
    }
    return o;
}

static DynArray *convert_arr(yyjson_val *arr) {
    DynArray *a = cs2_dynarray_new();
    yyjson_arr_iter iter;
    yyjson_arr_iter_init(arr, &iter);
    yyjson_val *val;
    while ((val = yyjson_arr_iter_next(&iter))) {
        if (yyjson_is_real(val) || yyjson_is_int(val)) {
            double v = yyjson_is_real(val) ? yyjson_get_real(val) : (double)yyjson_get_sint(val);
            cs2_dynarray_push_f64(a, v);
        } else if (yyjson_is_str(val)) {
            cs2_dynarray_push_str(a, strdup_safe(yyjson_get_str(val)));
        } else if (yyjson_is_true(val)) {
            cs2_dynarray_push_bool(a, 1);
        } else if (yyjson_is_false(val)) {
            cs2_dynarray_push_bool(a, 0);
        } else if (yyjson_is_null(val)) {
            cs2_dynarray_push_null(a);
        } else if (yyjson_is_obj(val)) {
            cs2_dynarray_push_obj(a, convert_obj(val));
        } else if (yyjson_is_arr(val)) {
            cs2_dynarray_push_arr(a, convert_arr(val));
        }
    }
    return a;
}

DynObj *cs2_json_parse_obj(const char *str) {
    if (!str) return NULL;
    yyjson_doc *doc = yyjson_read(str, strlen(str), 0);
    if (!doc) return NULL;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (!root || !yyjson_is_obj(root)) {
        yyjson_doc_free(doc);
        return NULL;
    }
    DynObj *result = convert_obj(root);
    yyjson_doc_free(doc);
    return result;
}

DynArray *cs2_json_parse_arr(const char *str) {
    if (!str) return NULL;
    yyjson_doc *doc = yyjson_read(str, strlen(str), 0);
    if (!doc) return NULL;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (!root || !yyjson_is_arr(root)) {
        yyjson_doc_free(doc);
        return NULL;
    }
    DynArray *result = convert_arr(root);
    yyjson_doc_free(doc);
    return result;
}
