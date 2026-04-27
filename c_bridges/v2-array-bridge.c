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

int32_t cs2_num_array_index_of(NumArray *arr, double value) {
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
