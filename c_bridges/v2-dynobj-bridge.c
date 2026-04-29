#include <stdlib.h>
#include <string.h>
#include <math.h>

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

static int32_t find_key(DynObj *o, const char *key) {
    for (int32_t i = 0; i < o->length; i++) {
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

double cs2_dynobj_get_f64(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_F64) return o->values[idx].f64_val;
    return 0.0 / 0.0;
}

char *cs2_dynobj_get_str(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_STRING) return o->values[idx].str_val;
    return NULL;
}

int32_t cs2_dynobj_get_bool(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_BOOL) return o->values[idx].bool_val;
    return 0;
}

DynObj *cs2_dynobj_get_obj(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_OBJECT) return (DynObj *)o->values[idx].obj_val;
    return NULL;
}

DynArray *cs2_dynobj_get_arr(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx >= 0 && o->values[idx].tag == TAG_ARRAY) return (DynArray *)o->values[idx].arr_val;
    return NULL;
}

extern uint64_t nanbox_from_f64(double val);
extern uint64_t nanbox_from_string(const char *s);
extern uint64_t nanbox_from_bool(int32_t val);
extern uint64_t nanbox_from_ptr(void *p);

uint64_t cs2_dynobj_get_boxed(DynObj *o, const char *key) {
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
    return (DynObj *)a->data[i].obj_val;
}

DynArray *cs2_dynarray_get_arr(DynArray *a, int32_t i) {
    return (DynArray *)a->data[i].arr_val;
}

int32_t cs2_dynarray_get_bool(DynArray *a, int32_t i) {
    return a->data[i].bool_val;
}

DynArray *cs2_dynarray_filter(DynArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, DynObj *) = (int32_t (*)(void *, DynObj *))fn_ptr;
    DynArray *result = cs2_dynarray_new();
    for (int32_t i = 0; i < arr->length; i++) {
        DynObj *elem = arr->data[i].obj_val;
        if (fn(env_ptr, elem)) {
            cs2_dynarray_push_obj(result, elem);
        }
    }
    return result;
}

DynArray *cs2_dynarray_map(DynArray *arr, void *fn_ptr, void *env_ptr) {
    DynObj *(*fn)(void *, DynObj *) = (DynObj *(*)(void *, DynObj *))fn_ptr;
    DynArray *result = cs2_dynarray_new();
    for (int32_t i = 0; i < arr->length; i++) {
        DynObj *elem = arr->data[i].obj_val;
        DynObj *mapped = fn(env_ptr, elem);
        cs2_dynarray_push_obj(result, mapped);
    }
    return result;
}

void cs2_dynarray_forEach(DynArray *arr, void *fn_ptr, void *env_ptr) {
    void (*fn)(void *, DynObj *) = (void (*)(void *, DynObj *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        fn(env_ptr, arr->data[i].obj_val);
    }
}

DynObj *cs2_dynarray_find(DynArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, DynObj *) = (int32_t (*)(void *, DynObj *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        DynObj *elem = arr->data[i].obj_val;
        if (fn(env_ptr, elem)) return elem;
    }
    return NULL;
}

double cs2_dynarray_findIndex(DynArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, DynObj *) = (int32_t (*)(void *, DynObj *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i].obj_val)) return (double)i;
    }
    return -1.0;
}

double cs2_dynarray_every(DynArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, DynObj *) = (int32_t (*)(void *, DynObj *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (!fn(env_ptr, arr->data[i].obj_val)) return 0.0;
    }
    return 1.0;
}

double cs2_dynarray_some(DynArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, DynObj *) = (int32_t (*)(void *, DynObj *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i].obj_val)) return 1.0;
    }
    return 0.0;
}
