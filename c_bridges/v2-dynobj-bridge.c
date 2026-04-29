#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define DYNOBJ_INITIAL_CAP 8

typedef struct {
    char **keys;
    uint64_t *values;
    int32_t length;
    int32_t capacity;
} DynObj;

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
    DynValue *data;
    int32_t length;
    int32_t capacity;
} DynArray;

extern uint64_t nanbox_from_f64(double val);
extern uint64_t nanbox_from_string(const char *s);
extern uint64_t nanbox_from_bool(int32_t val);
extern uint64_t nanbox_from_ptr(void *p);
extern uint64_t nanbox_null(void);

DynObj *cs2_dynobj_new(void) {
    DynObj *o = (DynObj *)malloc(sizeof(DynObj));
    o->capacity = DYNOBJ_INITIAL_CAP;
    o->length = 0;
    o->keys = (char **)malloc(sizeof(char *) * o->capacity);
    o->values = (uint64_t *)malloc(sizeof(uint64_t) * o->capacity);
    return o;
}

static int32_t find_key(DynObj *o, const char *key) {
    for (int32_t i = 0; i < o->length; i++) {
        if (strcmp(o->keys[i], key) == 0) return i;
    }
    return -1;
}

void cs2_dynobj_set(DynObj *o, const char *key, uint64_t val) {
    int32_t idx = find_key(o, key);
    if (idx >= 0) {
        o->values[idx] = val;
        return;
    }
    if (o->length >= o->capacity) {
        o->capacity *= 2;
        o->keys = (char **)realloc(o->keys, sizeof(char *) * o->capacity);
        o->values = (uint64_t *)realloc(o->values, sizeof(uint64_t) * o->capacity);
    }
    o->keys[o->length] = (char *)key;
    o->values[o->length] = val;
    o->length++;
}

uint64_t cs2_dynobj_get(DynObj *o, const char *key) {
    int32_t idx = find_key(o, key);
    if (idx < 0) return nanbox_null();
    return o->values[idx];
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

int32_t cs2_dynobj_length(DynObj *o) {
    return o->length;
}

extern const char *cs2_boxed_to_string(uint64_t v);

char *cs2_dynobj_repr(DynObj *o) {
    size_t cap = 64;
    char *buf = (char *)malloc(cap);
    size_t len = 0;
    buf[len++] = '{';
    for (int32_t i = 0; i < o->length; i++) {
        if (i > 0) {
            if (len + 2 >= cap) { cap *= 2; buf = (char *)realloc(buf, cap); }
            buf[len++] = ',';
            buf[len++] = ' ';
        }
        const char *key = o->keys[i];
        const char *val = cs2_boxed_to_string(o->values[i]);
        size_t klen = strlen(key);
        size_t vlen = strlen(val);
        while (len + klen + vlen + 4 >= cap) { cap *= 2; buf = (char *)realloc(buf, cap); }
        buf[len++] = '\'';
        memcpy(buf + len, key, klen); len += klen;
        buf[len++] = '\'';
        buf[len++] = ':';
        buf[len++] = ' ';
        memcpy(buf + len, val, vlen); len += vlen;
    }
    if (len + 2 >= cap) { cap += 2; buf = (char *)realloc(buf, cap); }
    buf[len++] = '}';
    buf[len] = '\0';
    return buf;
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

#define TAG_F64    0
#define TAG_STRING 1
#define TAG_BOOL   2
#define TAG_NULL   3
#define TAG_OBJECT 4
#define TAG_ARRAY  5

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
