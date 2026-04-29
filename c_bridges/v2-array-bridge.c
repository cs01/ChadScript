#include <stdlib.h>
#include <string.h>
#include <stdio.h>

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

NumArray *cs2_num_array_new(int32_t capacity) {
    if (capacity < 4) capacity = 4;
    NumArray *arr = (NumArray *)malloc(sizeof(NumArray));
    arr->data = (double *)malloc(sizeof(double) * capacity);
    arr->length = 0;
    arr->capacity = capacity;
    return arr;
}

void cs2_num_array_push(NumArray *arr, double value) {
    if (arr->length >= arr->capacity) {
        arr->capacity *= 2;
        arr->data = (double *)realloc(arr->data, sizeof(double) * arr->capacity);
    }
    arr->data[arr->length++] = value;
}

double cs2_num_array_pop(NumArray *arr) {
    if (arr->length <= 0) return 0.0;
    return arr->data[--arr->length];
}

double cs2_num_array_get(NumArray *arr, int32_t index) {
    if (index < 0) index += arr->length;
    if (index < 0 || index >= arr->length) return 0.0;
    return arr->data[index];
}

void cs2_num_array_fill(NumArray *arr, double value) {
    for (int32_t i = 0; i < arr->length; i++) {
        arr->data[i] = value;
    }
}

double cs2_num_array_at(NumArray *arr, int32_t index) {
    if (index < 0) index += arr->length;
    if (index < 0 || index >= arr->length) return 0.0;
    return arr->data[index];
}

void cs2_num_array_set(NumArray *arr, int32_t index, double value) {
    if (index < 0 || index >= arr->length) return;
    arr->data[index] = value;
}

int32_t cs2_num_array_length(NumArray *arr) {
    return arr->length;
}

int64_t cs2_num_array_index_of(NumArray *arr, double value) {
    for (int32_t i = 0; i < arr->length; i++) {
        if (arr->data[i] == value) return i;
    }
    return -1;
}

int32_t cs2_num_array_includes(NumArray *arr, double value) {
    for (int32_t i = 0; i < arr->length; i++) {
        if (arr->data[i] == value) return 1;
    }
    return 0;
}

NumArray *cs2_num_array_slice(NumArray *arr, int32_t start, int32_t end) {
    if (start < 0) start = arr->length + start;
    if (end < 0) end = arr->length + end;
    if (start < 0) start = 0;
    if (end > arr->length) end = arr->length;
    if (start >= end) return cs2_num_array_new(4);
    int32_t len = end - start;
    NumArray *result = cs2_num_array_new(len);
    memcpy(result->data, arr->data + start, sizeof(double) * len);
    result->length = len;
    return result;
}

void cs2_num_array_reverse(NumArray *arr) {
    for (int32_t i = 0, j = arr->length - 1; i < j; i++, j--) {
        double tmp = arr->data[i];
        arr->data[i] = arr->data[j];
        arr->data[j] = tmp;
    }
}

char *cs2_num_array_join(NumArray *arr, const char *sep) {
    if (arr->length == 0) {
        char *empty = (char *)malloc(1);
        empty[0] = '\0';
        return empty;
    }
    size_t sep_len = strlen(sep);
    size_t buf_size = arr->length * 24 + (arr->length - 1) * sep_len + 1;
    char *buf = (char *)malloc(buf_size);
    size_t pos = 0;
    for (int32_t i = 0; i < arr->length; i++) {
        if (i > 0) {
            memcpy(buf + pos, sep, sep_len);
            pos += sep_len;
        }
        pos += sprintf(buf + pos, "%.17g", arr->data[i]);
    }
    buf[pos] = '\0';
    return buf;
}

void cs2_num_array_spread(NumArray *dest, NumArray *src) {
    int32_t needed = dest->length + src->length;
    if (needed > dest->capacity) {
        while (dest->capacity < needed) dest->capacity *= 2;
        dest->data = (double *)realloc(dest->data, sizeof(double) * dest->capacity);
    }
    memcpy(dest->data + dest->length, src->data, sizeof(double) * src->length);
    dest->length = needed;
}

typedef struct {
    void **data;
    int32_t length;
    int32_t capacity;
} ObjArray;

ObjArray *cs2_obj_array_new(int32_t capacity) {
    if (capacity < 4) capacity = 4;
    ObjArray *arr = (ObjArray *)malloc(sizeof(ObjArray));
    arr->data = (void **)malloc(sizeof(void *) * capacity);
    arr->length = 0;
    arr->capacity = capacity;
    return arr;
}

void cs2_obj_array_push(ObjArray *arr, void *value) {
    if (arr->length >= arr->capacity) {
        arr->capacity *= 2;
        arr->data = (void **)realloc(arr->data, sizeof(void *) * arr->capacity);
    }
    arr->data[arr->length++] = value;
}

void *cs2_obj_array_pop(ObjArray *arr) {
    if (arr->length <= 0) return NULL;
    return arr->data[--arr->length];
}

void *cs2_obj_array_get(ObjArray *arr, int32_t index) {
    if (index < 0 || index >= arr->length) return NULL;
    return arr->data[index];
}

void cs2_obj_array_set(ObjArray *arr, int32_t index, void *value) {
    if (index < 0 || index >= arr->length) return;
    arr->data[index] = value;
}

int32_t cs2_obj_array_length(ObjArray *arr) {
    return arr->length;
}

ObjArray *cs2_obj_array_map(ObjArray *arr, void *fn_ptr, void *env_ptr) {
    void *(*fn)(void *, void *) = (void *(*)(void *, void *))fn_ptr;
    ObjArray *result = cs2_obj_array_new(arr->length);
    for (int32_t i = 0; i < arr->length; i++) {
        result->data[i] = fn(env_ptr, arr->data[i]);
    }
    result->length = arr->length;
    return result;
}

ObjArray *cs2_obj_array_filter(ObjArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, void *) = (int32_t (*)(void *, void *))fn_ptr;
    ObjArray *result = cs2_obj_array_new(arr->length);
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) {
            cs2_obj_array_push(result, arr->data[i]);
        }
    }
    return result;
}

void cs2_obj_array_forEach(ObjArray *arr, void *fn_ptr, void *env_ptr) {
    void (*fn)(void *, void *) = (void (*)(void *, void *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        fn(env_ptr, arr->data[i]);
    }
}

void *cs2_obj_array_find(ObjArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, void *) = (int32_t (*)(void *, void *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return arr->data[i];
    }
    return NULL;
}

double cs2_obj_array_findIndex(ObjArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, void *) = (int32_t (*)(void *, void *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return (double)i;
    }
    return -1.0;
}

double cs2_obj_array_every(ObjArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, void *) = (int32_t (*)(void *, void *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (!fn(env_ptr, arr->data[i])) return 0.0;
    }
    return 1.0;
}

double cs2_obj_array_some(ObjArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, void *) = (int32_t (*)(void *, void *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return 1.0;
    }
    return 0.0;
}

void cs2_str_array_spread(StrArray *dest, StrArray *src) {
    int32_t needed = dest->length + src->length;
    if (needed > dest->capacity) {
        while (dest->capacity < needed) dest->capacity *= 2;
        dest->data = (char **)realloc(dest->data, sizeof(char *) * dest->capacity);
    }
    memcpy(dest->data + dest->length, src->data, sizeof(char *) * src->length);
    dest->length = needed;
}

StrArray *cs2_str_array_new(int32_t capacity) {
    if (capacity < 4) capacity = 4;
    StrArray *arr = (StrArray *)malloc(sizeof(StrArray));
    arr->data = (char **)malloc(sizeof(char *) * capacity);
    arr->length = 0;
    arr->capacity = capacity;
    return arr;
}

void cs2_str_array_push(StrArray *arr, const char *value) {
    if (arr->length >= arr->capacity) {
        arr->capacity *= 2;
        arr->data = (char **)realloc(arr->data, sizeof(char *) * arr->capacity);
    }
    arr->data[arr->length++] = (char *)value;
}

char *cs2_str_array_pop(StrArray *arr) {
    if (arr->length <= 0) return "";
    return arr->data[--arr->length];
}

char *cs2_str_array_get(StrArray *arr, int32_t index) {
    if (index < 0) index += arr->length;
    if (index < 0 || index >= arr->length) return "";
    return arr->data[index];
}

char *cs2_str_array_at(StrArray *arr, int32_t index) {
    if (index < 0) index += arr->length;
    if (index < 0 || index >= arr->length) return "";
    return arr->data[index];
}

void cs2_str_array_set(StrArray *arr, int32_t index, const char *value) {
    if (index < 0 || index >= arr->length) return;
    arr->data[index] = (char *)value;
}

int32_t cs2_str_array_length(StrArray *arr) {
    return arr->length;
}

int64_t cs2_str_array_index_of(StrArray *arr, const char *value) {
    for (int32_t i = 0; i < arr->length; i++) {
        if (strcmp(arr->data[i], value) == 0) return i;
    }
    return -1;
}

int32_t cs2_str_array_includes(StrArray *arr, const char *value) {
    for (int32_t i = 0; i < arr->length; i++) {
        if (strcmp(arr->data[i], value) == 0) return 1;
    }
    return 0;
}

StrArray *cs2_str_array_slice(StrArray *arr, int32_t start, int32_t end) {
    if (start < 0) start = arr->length + start;
    if (end < 0) end = arr->length + end;
    if (start < 0) start = 0;
    if (end > arr->length) end = arr->length;
    if (start >= end) {
        StrArray *empty = (StrArray *)malloc(sizeof(StrArray));
        empty->data = (char **)malloc(sizeof(char *) * 4);
        empty->length = 0;
        empty->capacity = 4;
        return empty;
    }
    int32_t len = end - start;
    StrArray *result = (StrArray *)malloc(sizeof(StrArray));
    result->data = (char **)malloc(sizeof(char *) * len);
    memcpy(result->data, arr->data + start, sizeof(char *) * len);
    result->length = len;
    result->capacity = len;
    return result;
}

void cs2_str_array_reverse(StrArray *arr) {
    for (int32_t i = 0, j = arr->length - 1; i < j; i++, j--) {
        char *tmp = arr->data[i];
        arr->data[i] = arr->data[j];
        arr->data[j] = tmp;
    }
}

StrArray *cs2_str_array_concat(StrArray *a, StrArray *b) {
    int32_t len = a->length + b->length;
    StrArray *result = (StrArray *)malloc(sizeof(StrArray));
    result->data = (char **)malloc(sizeof(char *) * (len < 4 ? 4 : len));
    memcpy(result->data, a->data, sizeof(char *) * a->length);
    memcpy(result->data + a->length, b->data, sizeof(char *) * b->length);
    result->length = len;
    result->capacity = len < 4 ? 4 : len;
    return result;
}

NumArray *cs2_num_array_concat(NumArray *a, NumArray *b) {
    int32_t len = a->length + b->length;
    NumArray *result = (NumArray *)malloc(sizeof(NumArray));
    result->data = (double *)malloc(sizeof(double) * (len < 4 ? 4 : len));
    memcpy(result->data, a->data, sizeof(double) * a->length);
    memcpy(result->data + a->length, b->data, sizeof(double) * b->length);
    result->length = len;
    result->capacity = len < 4 ? 4 : len;
    return result;
}

static int cs2_num_compare_asc(const void *a, const void *b) {
    double da = *(const double *)a;
    double db = *(const double *)b;
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
}

void cs2_num_array_sort(NumArray *arr) {
    qsort(arr->data, arr->length, sizeof(double), cs2_num_compare_asc);
}

double cs2_num_array_sum(NumArray *arr) {
    double s = 0.0;
    for (int32_t i = 0; i < arr->length; i++) s += arr->data[i];
    return s;
}

double cs2_num_array_min(NumArray *arr) {
    if (arr->length == 0) return 0.0;
    double m = arr->data[0];
    for (int32_t i = 1; i < arr->length; i++) if (arr->data[i] < m) m = arr->data[i];
    return m;
}

double cs2_num_array_max(NumArray *arr) {
    if (arr->length == 0) return 0.0;
    double m = arr->data[0];
    for (int32_t i = 1; i < arr->length; i++) if (arr->data[i] > m) m = arr->data[i];
    return m;
}

int32_t cs2_num_array_any(NumArray *arr) {
    for (int32_t i = 0; i < arr->length; i++) if (arr->data[i] != 0.0) return 1;
    return 0;
}

int32_t cs2_num_array_all(NumArray *arr) {
    for (int32_t i = 0; i < arr->length; i++) if (arr->data[i] == 0.0) return 0;
    return 1;
}

NumArray *cs2_num_array_copy(NumArray *arr) {
    NumArray *r = (NumArray *)malloc(sizeof(NumArray));
    r->capacity = arr->length > 0 ? arr->length : 8;
    r->length = arr->length;
    r->data = (double *)malloc(sizeof(double) * r->capacity);
    for (int32_t i = 0; i < arr->length; i++) r->data[i] = arr->data[i];
    return r;
}

typedef struct {
    void *fn_ptr;
    void *env_ptr;
} SortCtx;

static SortCtx g_sort_ctx;

static int cs2_custom_compare(const void *a, const void *b) {
    double (*fn)(void *, double, double) = (double (*)(void *, double, double))g_sort_ctx.fn_ptr;
    double result = fn(g_sort_ctx.env_ptr, *(const double *)a, *(const double *)b);
    if (result < 0) return -1;
    if (result > 0) return 1;
    return 0;
}

void cs2_num_array_sort_fn(NumArray *arr, void *fn_ptr, void *env_ptr) {
    g_sort_ctx.fn_ptr = fn_ptr;
    g_sort_ctx.env_ptr = env_ptr;
    qsort(arr->data, arr->length, sizeof(double), cs2_custom_compare);
}

typedef struct { void *fn_ptr; void *env_ptr; } KeyCtx;
static KeyCtx g_key_ctx;

static int cs2_key_compare(const void *a, const void *b) {
    double (*fn)(void *, double) = (double (*)(void *, double))g_key_ctx.fn_ptr;
    double ka = fn(g_key_ctx.env_ptr, *(const double *)a);
    double kb = fn(g_key_ctx.env_ptr, *(const double *)b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
}

void cs2_num_array_sort_by(NumArray *arr, void *fn_ptr, void *env_ptr) {
    g_key_ctx.fn_ptr = fn_ptr;
    g_key_ctx.env_ptr = env_ptr;
    qsort(arr->data, arr->length, sizeof(double), cs2_key_compare);
}

NumArray *cs2_num_array_map(NumArray *arr, void *fn_ptr, void *env_ptr) {
    double (*fn)(void *, double) = (double (*)(void *, double))fn_ptr;
    NumArray *result = cs2_num_array_new(arr->length);
    for (int32_t i = 0; i < arr->length; i++) {
        result->data[i] = fn(env_ptr, arr->data[i]);
    }
    result->length = arr->length;
    return result;
}

NumArray *cs2_num_array_filter(NumArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, double) = (int32_t (*)(void *, double))fn_ptr;
    NumArray *result = cs2_num_array_new(arr->length);
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) {
            cs2_num_array_push(result, arr->data[i]);
        }
    }
    return result;
}

void cs2_num_array_forEach(NumArray *arr, void *fn_ptr, void *env_ptr) {
    void (*fn)(void *, double) = (void (*)(void *, double))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        fn(env_ptr, arr->data[i]);
    }
}

StrArray *cs2_str_array_map(StrArray *arr, void *fn_ptr, void *env_ptr) {
    char *(*fn)(void *, const char *) = (char *(*)(void *, const char *))fn_ptr;
    StrArray *result = cs2_str_array_new(arr->length);
    for (int32_t i = 0; i < arr->length; i++) {
        result->data[i] = fn(env_ptr, arr->data[i]);
    }
    result->length = arr->length;
    return result;
}

StrArray *cs2_str_array_filter(StrArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, const char *) = (int32_t (*)(void *, const char *))fn_ptr;
    StrArray *result = cs2_str_array_new(arr->length);
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) {
            cs2_str_array_push(result, arr->data[i]);
        }
    }
    return result;
}

void cs2_str_array_forEach(StrArray *arr, void *fn_ptr, void *env_ptr) {
    void (*fn)(void *, const char *) = (void (*)(void *, const char *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        fn(env_ptr, arr->data[i]);
    }
}

double cs2_num_array_find(NumArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, double) = (int32_t (*)(void *, double))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return arr->data[i];
    }
    return 0.0 / 0.0;
}

double cs2_num_array_findIndex(NumArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, double) = (int32_t (*)(void *, double))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return (double)i;
    }
    return -1.0;
}

double cs2_num_array_every(NumArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, double) = (int32_t (*)(void *, double))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (!fn(env_ptr, arr->data[i])) return 0.0;
    }
    return 1.0;
}

double cs2_num_array_some(NumArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, double) = (int32_t (*)(void *, double))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return 1.0;
    }
    return 0.0;
}

double cs2_num_array_reduce(NumArray *arr, void *fn_ptr, void *env_ptr, double init) {
    double (*fn)(void *, double, double) = (double (*)(void *, double, double))fn_ptr;
    double acc = init;
    for (int32_t i = 0; i < arr->length; i++) {
        acc = fn(env_ptr, acc, arr->data[i]);
    }
    return acc;
}

double cs2_str_array_findIndex(StrArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, const char *) = (int32_t (*)(void *, const char *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return (double)i;
    }
    return -1.0;
}

double cs2_str_array_every(StrArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, const char *) = (int32_t (*)(void *, const char *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (!fn(env_ptr, arr->data[i])) return 0.0;
    }
    return 1.0;
}

double cs2_str_array_some(StrArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, const char *) = (int32_t (*)(void *, const char *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return 1.0;
    }
    return 0.0;
}

const char *cs2_str_array_find(StrArray *arr, void *fn_ptr, void *env_ptr) {
    int32_t (*fn)(void *, const char *) = (int32_t (*)(void *, const char *))fn_ptr;
    for (int32_t i = 0; i < arr->length; i++) {
        if (fn(env_ptr, arr->data[i])) return arr->data[i];
    }
    return "undefined";
}

const char *cs2_str_array_reduce(StrArray *arr, void *fn_ptr, void *env_ptr, const char *init) {
    const char *(*fn)(void *, const char *, const char *) = (const char *(*)(void *, const char *, const char *))fn_ptr;
    const char *acc = init;
    for (int32_t i = 0; i < arr->length; i++) {
        acc = fn(env_ptr, acc, arr->data[i]);
    }
    return acc;
}

double cs2_num_array_shift(NumArray *arr) {
    if (arr->length <= 0) return 0.0;
    double val = arr->data[0];
    for (int32_t i = 1; i < arr->length; i++) arr->data[i-1] = arr->data[i];
    arr->length--;
    return val;
}

void cs2_num_array_unshift(NumArray *arr, double value) {
    if (arr->length >= arr->capacity) {
        arr->capacity *= 2;
        arr->data = (double *)realloc(arr->data, sizeof(double) * arr->capacity);
    }
    for (int32_t i = arr->length; i > 0; i--) arr->data[i] = arr->data[i-1];
    arr->data[0] = value;
    arr->length++;
}

char *cs2_str_array_shift(StrArray *arr) {
    if (arr->length <= 0) return "";
    char *val = arr->data[0];
    for (int32_t i = 1; i < arr->length; i++) arr->data[i-1] = arr->data[i];
    arr->length--;
    return val;
}

void cs2_str_array_unshift(StrArray *arr, const char *value) {
    if (arr->length >= arr->capacity) {
        arr->capacity *= 2;
        arr->data = (char **)realloc(arr->data, sizeof(char *) * arr->capacity);
    }
    for (int32_t i = arr->length; i > 0; i--) arr->data[i] = arr->data[i-1];
    arr->data[0] = (char *)value;
    arr->length++;
}

static int str_cmp(const void *a, const void *b) {
    return strcmp(*(const char **)a, *(const char **)b);
}

void cs2_str_array_sort(StrArray *arr) {
    if (arr->length > 1) qsort(arr->data, arr->length, sizeof(char *), str_cmp);
}

void cs2_str_array_fill(StrArray *arr, const char *value) {
    for (int32_t i = 0; i < arr->length; i++) arr->data[i] = (char *)value;
}

StrArray *cs2_str_array_splice(StrArray *arr, int32_t start, int32_t deleteCount) {
    if (start < 0) start = arr->length + start;
    if (start < 0) start = 0;
    if (start > arr->length) start = arr->length;
    if (deleteCount < 0) deleteCount = 0;
    if (start + deleteCount > arr->length) deleteCount = arr->length - start;
    StrArray *removed = cs2_str_array_new(deleteCount < 4 ? 4 : deleteCount);
    for (int32_t i = 0; i < deleteCount; i++) {
        removed->data[i] = arr->data[start + i];
    }
    removed->length = deleteCount;
    int32_t tail = arr->length - start - deleteCount;
    for (int32_t i = 0; i < tail; i++) {
        arr->data[start + i] = arr->data[start + deleteCount + i];
    }
    arr->length -= deleteCount;
    return removed;
}

NumArray *cs2_num_array_splice(NumArray *arr, int32_t start, int32_t deleteCount) {
    if (start < 0) start = arr->length + start;
    if (start < 0) start = 0;
    if (start > arr->length) start = arr->length;
    if (deleteCount < 0) deleteCount = 0;
    if (start + deleteCount > arr->length) deleteCount = arr->length - start;
    NumArray *removed = cs2_num_array_new(deleteCount < 4 ? 4 : deleteCount);
    for (int32_t i = 0; i < deleteCount; i++) {
        removed->data[i] = arr->data[start + i];
    }
    removed->length = deleteCount;
    int32_t tail = arr->length - start - deleteCount;
    for (int32_t i = 0; i < tail; i++) {
        arr->data[start + i] = arr->data[start + deleteCount + i];
    }
    arr->length -= deleteCount;
    return removed;
}

char *cs2_str_array_join(StrArray *arr, const char *sep) {
    if (arr->length == 0) {
        char *empty = (char *)malloc(1);
        empty[0] = '\0';
        return empty;
    }
    size_t sep_len = strlen(sep);
    size_t total = 0;
    for (int32_t i = 0; i < arr->length; i++) {
        total += strlen(arr->data[i]);
    }
    total += (arr->length - 1) * sep_len + 1;
    char *buf = (char *)malloc(total);
    size_t pos = 0;
    for (int32_t i = 0; i < arr->length; i++) {
        if (i > 0) {
            memcpy(buf + pos, sep, sep_len);
            pos += sep_len;
        }
        size_t len = strlen(arr->data[i]);
        memcpy(buf + pos, arr->data[i], len);
        pos += len;
    }
    buf[pos] = '\0';
    return buf;
}

extern void cs2_format_number(char *out, double val);

void cs2_print_num_array(NumArray *arr) {
    printf("[");
    for (int32_t i = 0; i < arr->length; i++) {
        if (i > 0) printf(",");
        printf(" ");
        char buf[32];
        cs2_format_number(buf, arr->data[i]);
        printf("%s", buf);
    }
    if (arr->length > 0) printf(" ");
    printf("]");
}

void cs2_print_str_array(StrArray *arr) {
    printf("[");
    for (int32_t i = 0; i < arr->length; i++) {
        if (i > 0) printf(",");
        printf(" '%s'", arr->data[i]);
    }
    if (arr->length > 0) printf(" ");
    printf("]");
}
