#include <stdlib.h>
#include <string.h>
#include <stdint.h>

typedef struct {
    uint8_t *data;
    int32_t length;
} Uint8Array;

typedef struct {
    double *data;
    int32_t length;
} Float64Array;

Uint8Array *cs2_uint8array_new(double size) {
    int32_t n = (int32_t)size;
    if (n < 0) n = 0;
    Uint8Array *arr = (Uint8Array *)malloc(sizeof(Uint8Array));
    arr->data = (uint8_t *)calloc(n, sizeof(uint8_t));
    arr->length = n;
    return arr;
}

double cs2_uint8array_get(Uint8Array *arr, double index) {
    int32_t i = (int32_t)index;
    if (i < 0 || i >= arr->length) return 0.0;
    return (double)arr->data[i];
}

void cs2_uint8array_set(Uint8Array *arr, double index, double value) {
    int32_t i = (int32_t)index;
    if (i < 0 || i >= arr->length) return;
    arr->data[i] = (uint8_t)((int32_t)value & 0xFF);
}

double cs2_uint8array_length(Uint8Array *arr) {
    return (double)arr->length;
}

typedef struct {
    double *data;
    int32_t length;
    int32_t capacity;
} NumArray;

Uint8Array *cs2_uint8array_from_num_array(NumArray *src) {
    Uint8Array *arr = (Uint8Array *)malloc(sizeof(Uint8Array));
    arr->data = (uint8_t *)calloc(src->length, sizeof(uint8_t));
    arr->length = src->length;
    for (int32_t i = 0; i < src->length; i++) {
        arr->data[i] = (uint8_t)((int32_t)src->data[i] & 0xFF);
    }
    return arr;
}

Float64Array *cs2_float64array_from_num_array(NumArray *src) {
    Float64Array *arr = (Float64Array *)malloc(sizeof(Float64Array));
    arr->data = (double *)malloc(sizeof(double) * src->length);
    arr->length = src->length;
    memcpy(arr->data, src->data, sizeof(double) * src->length);
    return arr;
}

Float64Array *cs2_float64array_new(double size) {
    int32_t n = (int32_t)size;
    if (n < 0) n = 0;
    Float64Array *arr = (Float64Array *)malloc(sizeof(Float64Array));
    arr->data = (double *)calloc(n, sizeof(double));
    arr->length = n;
    return arr;
}

double cs2_float64array_get(Float64Array *arr, double index) {
    int32_t i = (int32_t)index;
    if (i < 0 || i >= arr->length) return 0.0;
    return arr->data[i];
}

void cs2_float64array_set(Float64Array *arr, double index, double value) {
    int32_t i = (int32_t)index;
    if (i < 0 || i >= arr->length) return;
    arr->data[i] = value;
}

double cs2_float64array_length(Float64Array *arr) {
    return (double)arr->length;
}
