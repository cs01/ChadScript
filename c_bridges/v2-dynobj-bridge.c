#include "cs2-alloc.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
#define DYNOBJ_INITIAL_CAP 8
#define DYNOBJ_INLINE_CAP 4

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

#define DYNOBJ_MAGIC 0x444F424A
#define DYNARRAY_MAGIC 0x44415252

typedef struct DynObj {
    int32_t magic;
    int32_t length;
    int32_t capacity;
    int32_t _pad;
    char **keys;
    DynValue *values;
    char *inline_keys[DYNOBJ_INLINE_CAP];
    DynValue inline_values[DYNOBJ_INLINE_CAP];
} DynObj;

typedef struct {
    int32_t magic;
    DynValue *data;
    int32_t length;
    int32_t capacity;
} DynArray;

int32_t cs2_dyn_kind(void *p) {
    if (!p) return 0;
    int32_t m = *(int32_t *)p;
    return m;
}

DynObj *cs2_dynobj_new(void) {
    DynObj *o = (DynObj *)malloc(sizeof(DynObj));
    o->magic = DYNOBJ_MAGIC;
    o->capacity = DYNOBJ_INLINE_CAP;
    o->length = 0;
    o->keys = o->inline_keys;
    o->values = o->inline_values;
    return o;
}

static void dynobj_promote(DynObj *o, int32_t needed) {
    int32_t new_cap = o->capacity * 2;
    while (new_cap < needed) new_cap *= 2;
    char **nk = (char **)malloc(sizeof(char *) * new_cap);
    DynValue *nv = (DynValue *)malloc(sizeof(DynValue) * new_cap);
    memcpy(nk, o->keys, sizeof(char *) * o->length);
    memcpy(nv, o->values, sizeof(DynValue) * o->length);
    o->keys = nk;
    o->values = nv;
    o->capacity = new_cap;
}

static int looks_like_nanbox_inline(void *p) {
    unsigned long v = (unsigned long)p;
    return (v & 0xFFF0000000000000UL) == 0x7FF0000000000000UL ||
           (v & 0xFFF0000000000000UL) == 0x3FF0000000000000UL;
}

static int32_t find_key(DynObj *o, const char *key) {
    if (!o || looks_like_nanbox_inline(o)) return -1;
    if (o->length < 0 || o->length > 1000000) return -1;
    int32_t n = o->length;
    char **ks = o->keys;
    for (int32_t i = 0; i < n; i++) {
        if (ks[i] == key) return i;
    }
    for (int32_t i = 0; i < n; i++) {
        if (!ks[i]) return -1;
        if (strcmp(ks[i], key) == 0) return i;
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
        dynobj_promote(o, o->length + 1);
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
        dynobj_promote(o, o->length + 1);
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
        dynobj_promote(o, o->length + 1);
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
        dynobj_promote(o, o->length + 1);
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
        dynobj_promote(o, o->length + 1);
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
        dynobj_promote(o, o->length + 1);
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
        dynobj_promote(o, o->length + 1);
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

DynObj *cs2_dynobj_copy(DynObj *src) {
    DynObj *o = (DynObj *)malloc(sizeof(DynObj));
    o->magic = DYNOBJ_MAGIC;
    o->capacity = DYNOBJ_INLINE_CAP;
    o->length = 0;
    o->keys = o->inline_keys;
    o->values = o->inline_values;
    if (!src) return o;
    if (src->length > o->capacity) dynobj_promote(o, src->length);
    for (int32_t i = 0; i < src->length; i++) {
        o->keys[i] = src->keys[i];
        o->values[i] = src->values[i];
    }
    o->length = src->length;
    return o;
}

const char *cs2_dynobj_key_at(DynObj *o, int32_t i) {
    if (!o || i < 0 || i >= o->length) return NULL;
    return o->keys[i];
}

typedef struct { char **data; int32_t length; int32_t capacity; } StrArrayHeader;
extern StrArrayHeader *cs2_str_array_new(int32_t capacity);
extern void cs2_str_array_push(StrArrayHeader *arr, const char *value);

StrArrayHeader *cs2_dynobj_keys(DynObj *o) {
    StrArrayHeader *result = cs2_str_array_new(o ? o->length : 0);
    if (!o) return result;
    for (int32_t i = 0; i < o->length; i++) {
        cs2_str_array_push(result, o->keys[i]);
    }
    return result;
}

extern DynArray *cs2_dynarray_new(void);
extern void cs2_dynarray_push_str(DynArray *a, const char *val);
extern void cs2_dynarray_push_boxed(DynArray *a, uint64_t val);
extern void cs2_dynarray_push_arr(DynArray *a, DynArray *val);

DynArray *cs2_dynobj_values(DynObj *o) {
    DynArray *result = cs2_dynarray_new();
    if (!o) return result;
    for (int32_t i = 0; i < o->length; i++) {
        cs2_dynarray_push_boxed(result, cs2_dynobj_get_boxed(o, o->keys[i]));
    }
    return result;
}

DynArray *cs2_dynobj_entries(DynObj *o) {
    DynArray *result = cs2_dynarray_new();
    if (!o) return result;
    for (int32_t i = 0; i < o->length; i++) {
        DynArray *pair = cs2_dynarray_new();
        cs2_dynarray_push_str(pair, o->keys[i]);
        cs2_dynarray_push_boxed(pair, cs2_dynobj_get_boxed(o, o->keys[i]));
        cs2_dynarray_push_arr(result, pair);
    }
    return result;
}

DynArray *cs2_dynarray_new(void) {
    DynArray *a = (DynArray *)malloc(sizeof(DynArray)); a->magic = DYNARRAY_MAGIC;
    a->magic = DYNARRAY_MAGIC;
    a->capacity = DYNOBJ_INITIAL_CAP;
    a->length = 0;
    a->data = (DynValue *)malloc(sizeof(DynValue) * a->capacity);
    return a;
}

typedef struct { void **data; int32_t length; int32_t capacity; } TypedObjArray;

DynArray *cs2_dynarray_from_obj_array(TypedObjArray *src) {
    if (!src) return NULL;
    if (src->length < 0 || src->length > 1000000) return NULL;
    DynArray *a = (DynArray *)malloc(sizeof(DynArray)); a->magic = DYNARRAY_MAGIC;
    a->capacity = src->length < DYNOBJ_INITIAL_CAP ? DYNOBJ_INITIAL_CAP : src->length;
    a->length = src->length;
    a->data = (DynValue *)malloc(sizeof(DynValue) * a->capacity);
    for (int32_t i = 0; i < src->length; i++) {
        a->data[i].tag = TAG_OBJECT;
        a->data[i].obj_val = src->data[i];
    }
    return a;
}

DynArray *cs2_dynarray_from_str_array(TypedObjArray *src) {
    if (!src) return NULL;
    if (src->length < 0 || src->length > 1000000) return NULL;
    DynArray *a = (DynArray *)malloc(sizeof(DynArray)); a->magic = DYNARRAY_MAGIC;
    a->capacity = src->length < DYNOBJ_INITIAL_CAP ? DYNOBJ_INITIAL_CAP : src->length;
    a->length = src->length;
    a->data = (DynValue *)malloc(sizeof(DynValue) * a->capacity);
    for (int32_t i = 0; i < src->length; i++) {
        a->data[i].tag = TAG_STRING;
        a->data[i].str_val = (char *)src->data[i];
    }
    return a;
}

typedef struct { double *data; int32_t length; int32_t capacity; } TypedNumArray;

DynArray *cs2_dynarray_from_num_array(TypedNumArray *src) {
    if (!src) return NULL;
    if (src->length < 0 || src->length > 1000000) return NULL;
    DynArray *a = (DynArray *)malloc(sizeof(DynArray)); a->magic = DYNARRAY_MAGIC;
    a->capacity = src->length < DYNOBJ_INITIAL_CAP ? DYNOBJ_INITIAL_CAP : src->length;
    a->length = src->length;
    a->data = (DynValue *)malloc(sizeof(DynValue) * a->capacity);
    for (int32_t i = 0; i < src->length; i++) {
        a->data[i].tag = TAG_F64;
        a->data[i].f64_val = src->data[i];
    }
    return a;
}

DynArray *cs2_dynarray_from_boxed_array(TypedObjArray *src) {
    if (!src) return NULL;
    if (src->length < 0 || src->length > 1000000) return NULL;
    DynArray *a = (DynArray *)malloc(sizeof(DynArray)); a->magic = DYNARRAY_MAGIC;
    a->capacity = src->length < DYNOBJ_INITIAL_CAP ? DYNOBJ_INITIAL_CAP : src->length;
    a->length = src->length;
    a->data = (DynValue *)malloc(sizeof(DynValue) * a->capacity);
    for (int32_t i = 0; i < src->length; i++) {
        uint64_t v = (uint64_t)(uintptr_t)src->data[i];
        if ((v & 0xFFFC000000000000ULL) != 0x7FFC000000000000ULL) {
            double d;
            memcpy(&d, &v, 8);
            a->data[i].tag = TAG_F64;
            a->data[i].f64_val = d;
        } else if ((v & 0xFFFF000000000000ULL) == 0x7FFF000000000000ULL) {
            a->data[i].tag = TAG_STRING;
            a->data[i].str_val = (char *)(uintptr_t)(v & 0x0000FFFFFFFFFFFFULL);
        } else if ((v & 0xFFFF000000000000ULL) == 0x7FFE000000000000ULL) {
            int32_t ival = (int32_t)(v & 0x0000FFFFFFFFFFFFULL);
            if (v & 0x0000800000000000ULL) ival |= (int32_t)0xFFFF0000;
            a->data[i].tag = TAG_F64;
            a->data[i].f64_val = (double)ival;
        } else if ((v & 0xFFFF000000000000ULL) == 0x7FFD000000000000ULL) {
            a->data[i].tag = TAG_OBJECT;
            a->data[i].obj_val = (void *)(uintptr_t)(v & 0x0000FFFFFFFFFFFFULL);
        } else if (v == 0x7FFC000000000004ULL) {
            a->data[i].tag = TAG_BOOL; a->data[i].bool_val = 1;
        } else if (v == 0x7FFC000000000003ULL) {
            a->data[i].tag = TAG_BOOL; a->data[i].bool_val = 0;
        } else {
            a->data[i].tag = TAG_NULL;
        }
    }
    return a;
}

TypedObjArray *cs2_obj_array_from_dynarray(DynArray *src) {
    if (!src) return NULL;
    if (src->length < 0 || src->length > 1000000) return NULL;
    TypedObjArray *a = (TypedObjArray *)malloc(sizeof(TypedObjArray));
    a->capacity = src->length < 4 ? 4 : src->length;
    a->length = src->length;
    a->data = (void **)malloc(sizeof(void *) * a->capacity);
    for (int32_t i = 0; i < src->length; i++) {
        a->data[i] = src->data[i].obj_val;
    }
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
