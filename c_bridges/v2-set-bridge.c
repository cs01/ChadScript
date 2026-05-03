#include "cs2-alloc.h"
#include <stdlib.h>
#include <string.h>

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} StrSet;

typedef struct {
    double *data;
    int32_t length;
    int32_t capacity;
} NumSet;

StrSet *cs2_str_set_new(void) {
    StrSet *s = (StrSet *)malloc(sizeof(StrSet));
    s->capacity = 8;
    s->length = 0;
    s->data = (char **)malloc(sizeof(char *) * s->capacity);
    return s;
}

void cs2_str_set_add(StrSet *s, const char *val) {
    for (int32_t i = 0; i < s->length; i++) {
        if (strcmp(s->data[i], val) == 0) return;
    }
    if (s->length >= s->capacity) {
        s->capacity *= 2;
        s->data = (char **)realloc(s->data, sizeof(char *) * s->capacity);
    }
    s->data[s->length++] = (char *)val;
}

int32_t cs2_str_set_has(StrSet *s, const char *val) {
    for (int32_t i = 0; i < s->length; i++) {
        if (strcmp(s->data[i], val) == 0) return 1;
    }
    return 0;
}

int32_t cs2_str_set_delete(StrSet *s, const char *val) {
    for (int32_t i = 0; i < s->length; i++) {
        if (strcmp(s->data[i], val) == 0) {
            s->length--;
            s->data[i] = s->data[s->length];
            return 1;
        }
    }
    return 0;
}

int32_t cs2_str_set_size(StrSet *s) {
    return s->length;
}

NumSet *cs2_num_set_new(void) {
    NumSet *s = (NumSet *)malloc(sizeof(NumSet));
    s->capacity = 8;
    s->length = 0;
    s->data = (double *)malloc(sizeof(double) * s->capacity);
    return s;
}

void cs2_num_set_add(NumSet *s, double val) {
    for (int32_t i = 0; i < s->length; i++) {
        if (s->data[i] == val) return;
    }
    if (s->length >= s->capacity) {
        s->capacity *= 2;
        s->data = (double *)realloc(s->data, sizeof(double) * s->capacity);
    }
    s->data[s->length++] = val;
}

int32_t cs2_num_set_has(NumSet *s, double val) {
    for (int32_t i = 0; i < s->length; i++) {
        if (s->data[i] == val) return 1;
    }
    return 0;
}

int32_t cs2_num_set_delete(NumSet *s, double val) {
    for (int32_t i = 0; i < s->length; i++) {
        if (s->data[i] == val) {
            s->length--;
            s->data[i] = s->data[s->length];
            return 1;
        }
    }
    return 0;
}

int32_t cs2_num_set_size(NumSet *s) {
    return s->length;
}

typedef struct { char **data; int32_t length; int32_t capacity; } CS2StrArr2;
typedef struct { double *data; int32_t length; int32_t capacity; } CS2NumArr2;

CS2StrArr2 *cs2_str_set_values(StrSet *s) {
    CS2StrArr2 *a = (CS2StrArr2 *)malloc(sizeof(CS2StrArr2));
    int32_t cap = s->length < 4 ? 4 : s->length;
    a->data = (char **)malloc(sizeof(char *) * cap);
    a->length = s->length; a->capacity = cap;
    for (int32_t i = 0; i < s->length; i++) a->data[i] = s->data[i];
    return a;
}

CS2NumArr2 *cs2_num_set_values(NumSet *s) {
    CS2NumArr2 *a = (CS2NumArr2 *)malloc(sizeof(CS2NumArr2));
    int32_t cap = s->length < 4 ? 4 : s->length;
    a->data = (double *)malloc(sizeof(double) * cap);
    a->length = s->length; a->capacity = cap;
    for (int32_t i = 0; i < s->length; i++) a->data[i] = s->data[i];
    return a;
}

void cs2_str_set_clear(StrSet *s) { s->length = 0; }
void cs2_num_set_clear(NumSet *s) { s->length = 0; }
