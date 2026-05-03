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
    int32_t magic;
    char **keys;
    DynValue *values;
    int32_t length;
    int32_t capacity;
} DynObj;

typedef struct {
    int32_t magic;
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

#define NB_TAG_UNDEFINED 0x7FFC000000000001ULL
#define NB_TAG_NULL      0x7FFC000000000002ULL
#define NB_TAG_FALSE     0x7FFC000000000003ULL
#define NB_TAG_TRUE      0x7FFC000000000004ULL
#define NB_TAG_PTR       0x7FFD000000000000ULL
#define NB_TAG_INT       0x7FFE000000000000ULL
#define NB_TAG_STRING    0x7FFF000000000000ULL
#define NB_MASK_QUIET    0x7FFC000000000000ULL
#define NB_MASK_PAYLOAD  0x0000FFFFFFFFFFFFULL

typedef struct {
    void **data;
    int32_t length;
    int32_t capacity;
} ObjArrayLocal;

static yyjson_mut_val *dynobj_to_yyjson(yyjson_mut_doc *doc, DynObj *o);
static yyjson_mut_val *dynarray_to_yyjson(yyjson_mut_doc *doc, DynArray *a);
static yyjson_mut_val *boxed_to_yyjson(yyjson_mut_doc *doc, uint64_t v);

static yyjson_mut_val *dynvalue_to_yyjson(yyjson_mut_doc *doc, DynValue *v) {
    switch (v->tag) {
        case TAG_F64: {
            double d = v->f64_val;
            if (d == (double)(int64_t)d && d >= -9007199254740992.0 && d <= 9007199254740992.0) {
                return yyjson_mut_int(doc, (int64_t)d);
            }
            return yyjson_mut_real(doc, d);
        }
        case TAG_STRING: return yyjson_mut_str(doc, v->str_val ? v->str_val : "");
        case TAG_BOOL:   return yyjson_mut_bool(doc, v->bool_val);
        case TAG_NULL:   return yyjson_mut_null(doc);
        case TAG_OBJECT: return dynobj_to_yyjson(doc, (DynObj *)v->obj_val);
        case TAG_ARRAY:  return dynarray_to_yyjson(doc, (DynArray *)v->arr_val);
        default:         return yyjson_mut_null(doc);
    }
}

static yyjson_mut_val *dynobj_to_yyjson(yyjson_mut_doc *doc, DynObj *o) {
    if (!o) return yyjson_mut_null(doc);
    yyjson_mut_val *root = yyjson_mut_obj(doc);
    for (int32_t i = 0; i < o->length; i++) {
        const char *k = o->keys[i];
        yyjson_mut_val *v = dynvalue_to_yyjson(doc, &o->values[i]);
        yyjson_mut_obj_add(root, yyjson_mut_str(doc, k ? k : ""), v);
    }
    return root;
}

static yyjson_mut_val *dynarray_to_yyjson(yyjson_mut_doc *doc, DynArray *a) {
    if (!a) return yyjson_mut_null(doc);
    yyjson_mut_val *root = yyjson_mut_arr(doc);
    for (int32_t i = 0; i < a->length; i++) {
        yyjson_mut_arr_append(root, dynvalue_to_yyjson(doc, &a->data[i]));
    }
    return root;
}

static yyjson_mut_val *boxed_to_yyjson(yyjson_mut_doc *doc, uint64_t v) {
    if (v == NB_TAG_NULL || v == NB_TAG_UNDEFINED) return yyjson_mut_null(doc);
    if (v == NB_TAG_TRUE) return yyjson_mut_bool(doc, 1);
    if (v == NB_TAG_FALSE) return yyjson_mut_bool(doc, 0);
    if ((v & 0xFFFF000000000000ULL) == NB_TAG_STRING) {
        const char *s = (const char *)(uintptr_t)(v & NB_MASK_PAYLOAD);
        return yyjson_mut_str(doc, s ? s : "");
    }
    if ((v & 0xFFFF000000000000ULL) == NB_TAG_INT) {
        int32_t ival = (int32_t)(v & NB_MASK_PAYLOAD);
        if (v & 0x0000800000000000ULL) ival |= (int32_t)0xFFFF0000;
        return yyjson_mut_int(doc, (int64_t)ival);
    }
    if ((v & 0xFFFF000000000000ULL) == NB_TAG_PTR) {
        void *p = (void *)(uintptr_t)(v & NB_MASK_PAYLOAD);
        if (p) {
            int32_t magic = *(int32_t *)p;
            if (magic == 0x44415252) return dynarray_to_yyjson(doc, (DynArray *)p);
            if (magic == 0x444F424A) return dynobj_to_yyjson(doc, (DynObj *)p);
        }
        return yyjson_mut_null(doc);
    }
    if ((v & NB_MASK_QUIET) != NB_MASK_QUIET) {
        double d;
        memcpy(&d, &v, 8);
        if (d == (double)(int64_t)d && d >= -9007199254740992.0 && d <= 9007199254740992.0) {
            return yyjson_mut_int(doc, (int64_t)d);
        }
        return yyjson_mut_real(doc, d);
    }
    return yyjson_mut_null(doc);
}

char *cs2_json_stringify_dynobj(DynObj *o) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_doc_set_root(doc, dynobj_to_yyjson(doc, o));
    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
}

char *cs2_json_stringify_dynarray(DynArray *a) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_doc_set_root(doc, dynarray_to_yyjson(doc, a));
    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
}

char *cs2_json_stringify_obj_array(ObjArrayLocal *arr) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_arr(doc);
    yyjson_mut_doc_set_root(doc, root);
    if (arr) {
        for (int32_t i = 0; i < arr->length; i++) {
            uint64_t v = (uint64_t)(uintptr_t)arr->data[i];
            yyjson_mut_arr_append(root, boxed_to_yyjson(doc, v));
        }
    }
    size_t len;
    char *result = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return result;
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
