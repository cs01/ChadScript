#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
#define DYNOBJ_INITIAL_CAP 8

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

DynObj *cs2_dynobj_new(void) {
    DynObj *o = (DynObj *)malloc(sizeof(DynObj));
    o->capacity = DYNOBJ_INITIAL_CAP;
    o->length = 0;
    o->keys = (char **)malloc(sizeof(char *) * o->capacity);
    o->values = (DynValue *)malloc(sizeof(DynValue) * o->capacity);
    return o;
}

static int looks_like_nanbox_inline(void *p) {
    unsigned long v = (unsigned long)p;
    return (v & 0xFFF0000000000000UL) == 0x7FF0000000000000UL ||
           (v & 0xFFF0000000000000UL) == 0x3FF0000000000000UL;
}

static int32_t find_key(DynObj *o, const char *key) {
    if (!o || looks_like_nanbox_inline(o)) return -1;
    if (o->length < 0 || o->length > 1000) return -1;
    for (int32_t i = 0; i < o->length; i++) {
        if (!o->keys[i]) return -1;
        if (strcmp(o->keys[i], key) == 0) return i;
    }
    return -1;
}

void cs2_dynobj_set_f64(DynObj *o, const char *key, double val) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx].tag = TAG_F64;
        o->values[idx].f64_val = val;
        return;
    }
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (DynValue *)realloc(o->values, sizeof(DynValue) * o->capacity);
    }
    o->keys[o->length] = (char *)key;
    o->values[o->length].tag = TAG_F64;
    o->values[o->length].f64_val = val;
    o->length++;
}

void cs2_dynobj_set_str(DynObj *o, const char *key, const char *val) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx].tag = TAG_STRING;
        o->values[idx].str_val = (char *)val;
        return;
    }
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (DynValue *)realloc(o->values, sizeof(DynValue) * o->capacity);
    }
    o->keys[o->length] = (char *)key;
    o->values[o->length].tag = TAG_STRING;
    o->values[o->length].str_val = (char *)val;
    o->length++;
}

void cs2_dynobj_set_bool(DynObj *o, const char *key, int32_t val) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx].tag = TAG_BOOL;
        o->values[idx].bool_val = val;
        return;
    }
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (DynValue *)realloc(o->values, sizeof(DynValue) * o->capacity);
    }
    o->keys[o->length] = (char *)key;
    o->values[o->length].tag = TAG_BOOL;
    o->values[o->length].bool_val = val;
    o->length++;
}

void cs2_dynobj_set_null(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx].tag = TAG_NULL;
        return;
    }
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (DynValue *)realloc(o->values, sizeof(DynValue) * o->capacity);
    }
    o->keys[o->length] = (char *)key;
    o->values[o->length].tag = TAG_NULL;
    o->length++;
}

void cs2_dynobj_set_obj(DynObj *o, const char *key, DynObj *val) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx].tag = TAG_OBJECT;
        o->values[idx].obj_val = val;
        return;
    }
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (DynValue *)realloc(o->values, sizeof(DynValue) * o->capacity);
    }
    o->keys[o->length] = (char *)key;
    o->values[o->length].tag = TAG_OBJECT;
    o->values[o->length].obj_val = val;
    o->length++;
}

void cs2_dynobj_set_arr(DynObj *o, const char *key, DynArray *val) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx].tag = TAG_ARRAY;
        o->values[idx].arr_val = val;
        return;
    }
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (DynValue *)realloc(o->values, sizeof(DynValue) * o->capacity);
    }
    o->keys[o->length] = (char *)key;
    o->values[o->length].tag = TAG_ARRAY;
    o->values[o->length].arr_val = val;
    o->length++;
}

extern int nanbox_is_string(uint64_t v);
extern int nanbox_is_ptr(uint64_t v);
extern int nanbox_is_bool(uint64_t v);
extern int nanbox_is_null(uint64_t v);
extern int nanbox_is_number(uint64_t v);
extern const char *nanbox_to_string(uint64_t v);
extern void *nanbox_to_ptr(uint64_t v);
extern double nanbox_to_f64(uint64_t v);

static void dynobj_ensure_capacity(DynObj *o) {
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (DynValue *)realloc(o->values, sizeof(DynValue) * o->capacity);
    }
}

static void dynobj_set_value(DynObj *o, const char *key, int32_t tag, DynValue val) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx] = val;
        o->values[idx].tag = tag;
        return;
    }
    dynobj_ensure_capacity(o);
    o->keys[o->length] = (char *)key;
    o->values[o->length] = val;
    o->values[o->length].tag = tag;
    o->length++;
}

void cs2_dynobj_set_boxed(DynObj *o, const char *key, uint64_t val) {
    DynValue dv;
    if (nanbox_is_string(val)) {
        dv.tag = TAG_STRING;
        dv.str_val = (char *)nanbox_to_string(val);
    } else if (nanbox_is_ptr(val)) {
        dv.tag = TAG_OBJECT;
        dv.obj_val = nanbox_to_ptr(val);
    } else if (nanbox_is_bool(val)) {
        dv.tag = TAG_BOOL;
        dv.bool_val = (val == 0x7FFC000000000004ULL) ? 1 : 0;
    } else if (nanbox_is_null(val)) {
        dv.tag = TAG_NULL;
        dv.f64_val = 0;
    } else {
        dv.tag = TAG_F64;
        dv.f64_val = nanbox_to_f64(val);
    }
    dynobj_set_value(o, key, dv.tag, dv);
}

double cs2_dynobj_get_f64(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_F64) return o->values[idx].f64_val;
    return 0.0 / 0.0;
}

static int looks_like_nanbox(void *p) {
    unsigned long v = (unsigned long)p;
    return (v & 0xFFF0000000000000UL) == 0x7FF0000000000000UL ||
           (v & 0xFFF0000000000000UL) == 0x3FF0000000000000UL;
}

char *cs2_dynobj_get_str(DynObj *o, const char *key) {
    if (!o || looks_like_nanbox(o)) return (char *)"";
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_STRING) return o->values[idx].str_val;
    return (char *)"";
}

int32_t cs2_dynobj_get_bool(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_BOOL) return o->values[idx].bool_val;
    return 0;
}

DynObj *cs2_dynobj_get_obj(DynObj *o, const char *key) {
    if (!o) return NULL;
    int32_t idx = find_key(o, key);
    if (idx < 0) return NULL;
    switch (o->values[idx].tag) {
        case TAG_OBJECT: return (DynObj *)o->values[idx].obj_val;
        case TAG_ARRAY:  return (DynObj *)o->values[idx].arr_val;
        case TAG_STRING: return (DynObj *)o->values[idx].str_val;
        default:         return NULL;
    }
}

DynArray *cs2_dynobj_get_arr(DynObj *o, const char *key) {
    if (!o) return NULL;
    int32_t idx = find_key(o, key);
    if (idx < 0) return NULL;
    if (o->values[idx].tag == TAG_ARRAY) return (DynArray *)o->values[idx].arr_val;
    if (o->values[idx].tag == TAG_OBJECT) return (DynArray *)o->values[idx].obj_val;
    return NULL;
}

extern uint64_t nanbox_from_f64(double val);
extern uint64_t nanbox_from_string(const char *s);
extern uint64_t nanbox_from_bool(int32_t val);
extern uint64_t nanbox_from_ptr(void *p);

uint64_t cs2_dynobj_get_boxed(DynObj *o, const char *key) {
    if (!o) return 0;
    int32_t idx = find_key(o, key);
    if (idx < 0) return 0;
    switch (o->values[idx].tag) {
        case TAG_F64:    return nanbox_from_f64(o->values[idx].f64_val);
        case TAG_STRING: return nanbox_from_string(o->values[idx].str_val);
        case TAG_BOOL:   return nanbox_from_bool(o->values[idx].bool_val);
        case TAG_OBJECT: return nanbox_from_ptr(o->values[idx].obj_val);
        case TAG_ARRAY:  return nanbox_from_ptr(o->values[idx].arr_val);
        default:         return 0;
    }
}

int32_t cs2_dynobj_has(DynObj *o, const char *key) {
    return find_key(o, key) >= 0 ? 1 : 0;
}

void cs2_dynobj_delete(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx < 0) return;
    o->length--;
    if (idx < (int32_t)o->length) {
        o->keys[idx] = o->keys[o->length];
        o->values[idx] = o->values[o->length];
    }
}

int32_t cs2_dynobj_tag(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) return o->values[idx].tag;
    return -1;
}

int32_t cs2_dynobj_length(DynObj *o) {
    return o->length;
}

DynArray *cs2_dynarray_new(void) {
    DynArray *a = (DynArray *)malloc(sizeof(DynArray));
    a->capacity = DYNOBJ_INITIAL_CAP;
    a->length = 0;
    a->data = (DynValue *)malloc(sizeof(DynValue) * a->capacity);
    return a;
}

static void dynarray_grow(DynArray *a) {
    if (a->length >= a->capacity) {
        a->capacity *= 2;
        a->data = (DynValue *)realloc(a->data, sizeof(DynValue) * a->capacity);
    }
}

void cs2_dynarray_push_f64(DynArray *a, double val) {
    dynarray_grow(a);
    a->data[a->length].tag = TAG_F64;
    a->data[a->length].f64_val = val;
    a->length++;
}

void cs2_dynarray_push_str(DynArray *a, const char *val) {
    dynarray_grow(a);
    a->data[a->length].tag = TAG_STRING;
    a->data[a->length].str_val = (char *)val;
    a->length++;
}

void cs2_dynarray_push_obj(DynArray *a, DynObj *val) {
    dynarray_grow(a);
    a->data[a->length].tag = TAG_OBJECT;
    a->data[a->length].obj_val = val;
    a->length++;
}

void cs2_dynarray_push_arr(DynArray *a, DynArray *val) {
    dynarray_grow(a);
    a->data[a->length].tag = TAG_ARRAY;
    a->data[a->length].arr_val = val;
    a->length++;
}

void cs2_dynarray_push_null(DynArray *a) {
    dynarray_grow(a);
    a->data[a->length].tag = TAG_NULL;
    a->length++;
}

void cs2_dynarray_push_bool(DynArray *a, int32_t val) {
    dynarray_grow(a);
    a->data[a->length].tag = TAG_BOOL;
    a->data[a->length].bool_val = val;
    a->length++;
}

int32_t cs2_dynarray_length(DynArray *a) {
    if (!a) return 0;
    return a->length;
}

int32_t cs2_dynarray_tag_at(DynArray *a, int32_t i) {
    if (i < 0 || i >= a->length) return -1;
    return a->data[i].tag;
}

double cs2_dynarray_get_f64(DynArray *a, int32_t i) {
    return a->data[i].f64_val;
}

char *cs2_dynarray_get_str(DynArray *a, int32_t i) {
    return a->data[i].str_val;
}

DynObj *cs2_dynarray_get_obj(DynArray *a, int32_t i) {
    if (!a || i < 0 || i >= a->length) return NULL;
    if (a->data[i].tag != TAG_OBJECT) return NULL;
    return (DynObj *)a->data[i].obj_val;
}

DynArray *cs2_dynarray_get_arr(DynArray *a, int32_t i) {
    return (DynArray *)a->data[i].arr_val;
}

int32_t cs2_dynarray_get_bool(DynArray *a, int32_t i) {
    return a->data[i].bool_val;
}

extern int nanbox_is_string(uint64_t v);
extern int nanbox_is_ptr(uint64_t v);
extern int nanbox_is_bool(uint64_t v);
extern int nanbox_is_null(uint64_t v);

#define BOXED_FALSE 0x7FFC000000000003ULL
#define BOXED_NULL  0x7FFC000000000005ULL

static int boxed_truthy(uint64_t v) {
    if (v == 0) return 0;
    if (v == BOXED_FALSE) return 0;
    if (v == BOXED_NULL) return 0;
    if (nanbox_is_string(v)) {
        const char *s = nanbox_to_string(v);
        return s && s[0] != '\0';
    }
    return 1;
}

void cs2_dynarray_push_boxed(DynArray *a, uint64_t val) {
    dynarray_grow(a);
    DynValue *dv = &a->data[a->length];
    if (nanbox_is_string(val)) {
        dv->tag = TAG_STRING;
        dv->str_val = (char *)nanbox_to_string(val);
    } else if (nanbox_is_ptr(val)) {
        dv->tag = TAG_OBJECT;
        dv->obj_val = nanbox_to_ptr(val);
    } else if (nanbox_is_bool(val)) {
        dv->tag = TAG_BOOL;
        dv->bool_val = (val == 0x7FFC000000000004ULL) ? 1 : 0;
    } else if (nanbox_is_null(val)) {
        dv->tag = TAG_NULL;
        dv->f64_val = 0;
    } else {
        dv->tag = TAG_F64;
        dv->f64_val = nanbox_to_f64(val);
    }
    a->length++;
}

uint64_t cs2_dynarray_get_boxed(DynArray *a, int32_t i) {
    if (!a || i < 0 || i >= a->length) return 0;
    DynValue *dv = &a->data[i];
    switch (dv->tag) {
        case TAG_F64:    return nanbox_from_f64(dv->f64_val);
        case TAG_STRING: return nanbox_from_string(dv->str_val);
        case TAG_BOOL:   return nanbox_from_bool(dv->bool_val);
        case TAG_OBJECT: return nanbox_from_ptr(dv->obj_val);
        case TAG_ARRAY:  return nanbox_from_ptr(dv->arr_val);
        default:         return 0;
    }
}

DynArray *cs2_dynarray_filter(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    DynArray *result = cs2_dynarray_new();
    for (int32_t i = 0; i < arr->length; i++) {
        uint64_t elem = cs2_dynarray_get_boxed(arr, i);
        if (boxed_truthy(fn(env_ptr, elem))) {
            dynarray_grow(result);
            result->data[result->length++] = arr->data[i];
        }
    }
    return result;
}

DynArray *cs2_dynarray_map(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    DynArray *result = cs2_dynarray_new();
    for (int32_t i = 0; i < arr->length; i++) {
        uint64_t elem = cs2_dynarray_get_boxed(arr, i);
        cs2_dynarray_push_boxed(result, fn(env_ptr, elem));
    }
    return result;
}

void cs2_dynarray_forEach(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        fn(env_ptr, cs2_dynarray_get_boxed(arr, i));
    }
}

uint64_t cs2_dynarray_find(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        uint64_t elem = cs2_dynarray_get_boxed(arr, i);
        if (boxed_truthy(fn(env_ptr, elem))) return elem;
    }
    return 0;
}

double cs2_dynarray_findIndex(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        uint64_t elem = cs2_dynarray_get_boxed(arr, i);
        if (boxed_truthy(fn(env_ptr, elem))) return (double)i;
    }
    return -1.0;
}

double cs2_dynarray_every(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        uint64_t elem = cs2_dynarray_get_boxed(arr, i);
        if (!boxed_truthy(fn(env_ptr, elem))) return 0.0;
    }
    return 1.0;
}

double cs2_dynarray_some(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        uint64_t elem = cs2_dynarray_get_boxed(arr, i);
        if (boxed_truthy(fn(env_ptr, elem))) return 1.0;
    }
    return 0.0;
}

DynArray *cs2_dynarray_flatMap(DynArray *arr, void *fn_ptr, void *env_ptr) {
    uint64_t (*fn)(void *, uint64_t) = (uint64_t (*)(void *, uint64_t))fn_ptr;
    DynArray *result = cs2_dynarray_new();
    for (int32_t i = 0; i < arr->length; i++) {
        uint64_t elem = cs2_dynarray_get_boxed(arr, i);
        uint64_t r = fn(env_ptr, elem);
        DynArray *sub = nanbox_is_ptr(r) ? (DynArray *)nanbox_to_ptr(r) : NULL;
        if (sub) {
            for (int32_t j = 0; j < sub->length; j++) {
                dynarray_grow(result);
                result->data[result->length++] = sub->data[j];
            }
        }
    }
    return result;
}
