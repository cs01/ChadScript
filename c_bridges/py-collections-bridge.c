#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>

typedef struct { char **keys; double *values; int32_t length; int32_t capacity; } StrNumMap;
typedef struct { double *keys; double *values; int32_t length; int32_t capacity; } NumNumMap;
typedef struct { double *data; int32_t length; int32_t capacity; } NumArray;
typedef struct { char **data; int32_t length; int32_t capacity; } StrArray;

extern StrNumMap *cs2_str_num_map_new(void);
extern void cs2_str_num_map_set(StrNumMap *m, const char *k, double v);
extern double cs2_str_num_map_get_or(StrNumMap *m, const char *k, double def);
extern NumNumMap *cs2_num_num_map_new(void);
extern void cs2_num_num_map_set(NumNumMap *m, double k, double v);
extern double cs2_num_num_map_get_or(NumNumMap *m, double k, double def);

NumNumMap *cs2_counter_num_new(NumArray *arr) {
    NumNumMap *m = cs2_num_num_map_new();
    if (!arr) return m;
    for (int i = 0; i < arr->length; i++) {
        double key = arr->data[i];
        cs2_num_num_map_set(m, key, cs2_num_num_map_get_or(m, key, 0.0) + 1.0);
    }
    return m;
}

StrNumMap *cs2_counter_str_new(StrArray *arr) {
    StrNumMap *m = cs2_str_num_map_new();
    if (!arr) return m;
    for (int i = 0; i < arr->length; i++) {
        const char *key = arr->data[i];
        cs2_str_num_map_set(m, key, cs2_str_num_map_get_or(m, key, 0.0) + 1.0);
    }
    return m;
}

StrNumMap *cs2_counter_str_from_string(const char *s) {
    StrNumMap *m = cs2_str_num_map_new();
    if (!s) return m;
    for (size_t i = 0; s[i]; i++) {
        char tmpkey[2] = {s[i], '\0'};
        double count = cs2_str_num_map_get_or(m, tmpkey, 0.0);
        if (count > 0.0) {
            cs2_str_num_map_set(m, tmpkey, count + 1.0);
        } else {
            char *hkey = (char *)malloc(2);
            hkey[0] = s[i]; hkey[1] = '\0';
            cs2_str_num_map_set(m, hkey, 1.0);
        }
    }
    return m;
}

int64_t cs2_counter_num_get(NumNumMap *m, double key) {
    return (int64_t)cs2_num_num_map_get_or(m, key, 0.0);
}

int64_t cs2_counter_str_get(StrNumMap *m, const char *key) {
    return (int64_t)cs2_str_num_map_get_or(m, key, 0.0);
}

typedef struct {
    double *data;
    int32_t length;
    int32_t capacity;
} CS2DequeNum;

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} CS2DequeStr;

CS2DequeNum *cs2_deque_num_new(NumArray *init) {
    CS2DequeNum *d = (CS2DequeNum *)malloc(sizeof(CS2DequeNum));
    d->capacity = init ? (init->length > 0 ? init->length * 2 : 8) : 8;
    d->length = 0;
    d->data = (double *)malloc(sizeof(double) * d->capacity);
    if (init) {
        memcpy(d->data, init->data, sizeof(double) * init->length);
        d->length = init->length;
    }
    return d;
}

void cs2_deque_num_append(CS2DequeNum *d, double v) {
    if (d->length >= d->capacity) {
        d->capacity *= 2;
        d->data = (double *)realloc(d->data, sizeof(double) * d->capacity);
    }
    d->data[d->length++] = v;
}

void cs2_deque_num_appendleft(CS2DequeNum *d, double v) {
    if (d->length >= d->capacity) {
        d->capacity *= 2;
        d->data = (double *)realloc(d->data, sizeof(double) * d->capacity);
    }
    memmove(d->data + 1, d->data, sizeof(double) * d->length);
    d->data[0] = v;
    d->length++;
}

double cs2_deque_num_pop(CS2DequeNum *d) {
    if (d->length <= 0) return 0.0;
    return d->data[--d->length];
}

double cs2_deque_num_popleft(CS2DequeNum *d) {
    if (d->length <= 0) return 0.0;
    double v = d->data[0];
    memmove(d->data, d->data + 1, sizeof(double) * (d->length - 1));
    d->length--;
    return v;
}

int32_t cs2_deque_num_len(CS2DequeNum *d) { return d ? d->length : 0; }

double cs2_deque_num_getf(CS2DequeNum *d, int64_t i) {
    if (!d || i < 0 || i >= d->length) return 0.0;
    return d->data[i];
}

int64_t cs2_deque_num_get(CS2DequeNum *d, int64_t i) {
    if (!d || i < 0 || i >= d->length) return 0;
    return (int64_t)d->data[i];
}
