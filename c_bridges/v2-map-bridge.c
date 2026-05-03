#include "cs2-alloc.h"
#include <stdlib.h>
#include <string.h>

typedef struct {
    char **keys;
    double *values;
    int32_t length;
    int32_t capacity;
} StrNumMap;

typedef struct {
    char **keys;
    char **values;
    int32_t length;
    int32_t capacity;
} StrStrMap;

typedef struct {
    double *keys;
    double *values;
    int32_t length;
    int32_t capacity;
} NumNumMap;

typedef struct {
    double *keys;
    char **values;
    int32_t length;
    int32_t capacity;
} NumStrMap;

static int32_t find_str_key(char **keys, int32_t len, const char *key) {
    for (int32_t i = 0; i < len; i++) {
        if (strcmp(keys[i], key) == 0) return i;
    }
    return -1;
}

static int32_t find_num_key(double *keys, int32_t len, double key) {
    for (int32_t i = 0; i < len; i++) {
        if (keys[i] == key) return i;
    }
    return -1;
}

static void grow_str_keys(char ***keys, int32_t *cap) {
    *cap *= 2;
    *keys = (char **)realloc(*keys, sizeof(char *) * (*cap));
}

static void grow_num_keys(double **keys, int32_t *cap) {
    *cap *= 2;
    *keys = (double *)realloc(*keys, sizeof(double) * (*cap));
}

StrNumMap *cs2_str_num_map_new(void) {
    StrNumMap *m = (StrNumMap *)malloc(sizeof(StrNumMap));
    m->capacity = 8;
    m->length = 0;
    m->keys = (char **)malloc(sizeof(char *) * m->capacity);
    m->values = (double *)malloc(sizeof(double) * m->capacity);
    return m;
}

void cs2_str_num_map_set(StrNumMap *m, const char *key, double val) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx >= 0) {
        m->values[idx] = val;
        return;
    }
    if (m->length >= m->capacity) {
        m->capacity *= 2;
        m->keys = (char **)realloc(m->keys, sizeof(char *) * m->capacity);
        m->values = (double *)realloc(m->values, sizeof(double) * m->capacity);
    }
    m->keys[m->length] = (char *)key;
    m->values[m->length] = val;
    m->length++;
}

double cs2_str_num_map_get(StrNumMap *m, const char *key) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx >= 0) return m->values[idx];
    return 0.0 / 0.0;
}

int32_t cs2_str_num_map_has(StrNumMap *m, const char *key) {
    return find_str_key(m->keys, m->length, key) >= 0 ? 1 : 0;
}

int32_t cs2_str_num_map_delete(StrNumMap *m, const char *key) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx < 0) return 0;
    m->length--;
    m->keys[idx] = m->keys[m->length];
    m->values[idx] = m->values[m->length];
    return 1;
}

int32_t cs2_str_num_map_size(StrNumMap *m) {
    return m->length;
}

StrStrMap *cs2_str_str_map_new(void) {
    StrStrMap *m = (StrStrMap *)malloc(sizeof(StrStrMap));
    m->capacity = 8;
    m->length = 0;
    m->keys = (char **)malloc(sizeof(char *) * m->capacity);
    m->values = (char **)malloc(sizeof(char *) * m->capacity);
    return m;
}

void cs2_str_str_map_set(StrStrMap *m, const char *key, const char *val) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx >= 0) {
        m->values[idx] = (char *)val;
        return;
    }
    if (m->length >= m->capacity) {
        m->capacity *= 2;
        m->keys = (char **)realloc(m->keys, sizeof(char *) * m->capacity);
        m->values = (char **)realloc(m->values, sizeof(char *) * m->capacity);
    }
    m->keys[m->length] = (char *)key;
    m->values[m->length] = (char *)val;
    m->length++;
}

char *cs2_str_str_map_get(StrStrMap *m, const char *key) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx >= 0) return m->values[idx];
    return NULL;
}

int32_t cs2_str_str_map_has(StrStrMap *m, const char *key) {
    return find_str_key(m->keys, m->length, key) >= 0 ? 1 : 0;
}

int32_t cs2_str_str_map_delete(StrStrMap *m, const char *key) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx < 0) return 0;
    m->length--;
    m->keys[idx] = m->keys[m->length];
    m->values[idx] = m->values[m->length];
    return 1;
}

int32_t cs2_str_str_map_size(StrStrMap *m) {
    return m->length;
}

NumNumMap *cs2_num_num_map_new(void) {
    NumNumMap *m = (NumNumMap *)malloc(sizeof(NumNumMap));
    m->capacity = 8;
    m->length = 0;
    m->keys = (double *)malloc(sizeof(double) * m->capacity);
    m->values = (double *)malloc(sizeof(double) * m->capacity);
    return m;
}

void cs2_num_num_map_set(NumNumMap *m, double key, double val) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx >= 0) {
        m->values[idx] = val;
        return;
    }
    if (m->length >= m->capacity) {
        m->capacity *= 2;
        m->keys = (double *)realloc(m->keys, sizeof(double) * m->capacity);
        m->values = (double *)realloc(m->values, sizeof(double) * m->capacity);
    }
    m->keys[m->length] = key;
    m->values[m->length] = val;
    m->length++;
}

double cs2_num_num_map_get(NumNumMap *m, double key) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx >= 0) return m->values[idx];
    return 0.0 / 0.0;
}

int32_t cs2_num_num_map_has(NumNumMap *m, double key) {
    return find_num_key(m->keys, m->length, key) >= 0 ? 1 : 0;
}

int32_t cs2_num_num_map_delete(NumNumMap *m, double key) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx < 0) return 0;
    m->length--;
    m->keys[idx] = m->keys[m->length];
    m->values[idx] = m->values[m->length];
    return 1;
}

int32_t cs2_num_num_map_size(NumNumMap *m) {
    return m->length;
}

NumStrMap *cs2_num_str_map_new(void) {
    NumStrMap *m = (NumStrMap *)malloc(sizeof(NumStrMap));
    m->capacity = 8;
    m->length = 0;
    m->keys = (double *)malloc(sizeof(double) * m->capacity);
    m->values = (char **)malloc(sizeof(char *) * m->capacity);
    return m;
}

void cs2_num_str_map_set(NumStrMap *m, double key, const char *val) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx >= 0) {
        m->values[idx] = (char *)val;
        return;
    }
    if (m->length >= m->capacity) {
        m->capacity *= 2;
        m->keys = (double *)realloc(m->keys, sizeof(double) * m->capacity);
        m->values = (char **)realloc(m->values, sizeof(char *) * m->capacity);
    }
    m->keys[m->length] = key;
    m->values[m->length] = (char *)val;
    m->length++;
}

char *cs2_num_str_map_get(NumStrMap *m, double key) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx >= 0) return m->values[idx];
    return NULL;
}

int32_t cs2_num_str_map_has(NumStrMap *m, double key) {
    return find_num_key(m->keys, m->length, key) >= 0 ? 1 : 0;
}

int32_t cs2_num_str_map_delete(NumStrMap *m, double key) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx < 0) return 0;
    m->length--;
    m->keys[idx] = m->keys[m->length];
    m->values[idx] = m->values[m->length];
    return 1;
}

int32_t cs2_num_str_map_size(NumStrMap *m) {
    return m->length;
}

void cs2_str_num_map_clear(StrNumMap *m) { m->length = 0; }
void cs2_str_str_map_clear(StrStrMap *m) { m->length = 0; }
void cs2_num_num_map_clear(NumNumMap *m) { m->length = 0; }
void cs2_num_str_map_clear(NumStrMap *m) { m->length = 0; }

StrNumMap *cs2_str_num_map_copy(StrNumMap *src) {
    StrNumMap *m = cs2_str_num_map_new();
    for (int32_t i = 0; i < src->length; i++) cs2_str_num_map_set(m, src->keys[i], src->values[i]);
    return m;
}
StrStrMap *cs2_str_str_map_copy(StrStrMap *src) {
    StrStrMap *m = cs2_str_str_map_new();
    for (int32_t i = 0; i < src->length; i++) cs2_str_str_map_set(m, src->keys[i], src->values[i]);
    return m;
}
NumNumMap *cs2_num_num_map_copy(NumNumMap *src) {
    NumNumMap *m = cs2_num_num_map_new();
    for (int32_t i = 0; i < src->length; i++) cs2_num_num_map_set(m, src->keys[i], src->values[i]);
    return m;
}
NumStrMap *cs2_num_str_map_copy(NumStrMap *src) {
    NumStrMap *m = cs2_num_str_map_new();
    for (int32_t i = 0; i < src->length; i++) cs2_num_str_map_set(m, src->keys[i], src->values[i]);
    return m;
}

const char *cs2_str_num_map_key_at(StrNumMap *m, int32_t i) { return m->keys[i]; }
double cs2_str_num_map_value_at(StrNumMap *m, int32_t i) { return m->values[i]; }
const char *cs2_str_str_map_key_at(StrStrMap *m, int32_t i) { return m->keys[i]; }
char *cs2_str_str_map_value_at(StrStrMap *m, int32_t i) { return m->values[i]; }
double cs2_num_num_map_key_at(NumNumMap *m, int32_t i) { return m->keys[i]; }
double cs2_num_num_map_value_at(NumNumMap *m, int32_t i) { return m->values[i]; }
double cs2_num_str_map_key_at(NumStrMap *m, int32_t i) { return m->keys[i]; }
char *cs2_num_str_map_value_at(NumStrMap *m, int32_t i) { return m->values[i]; }

typedef struct { char **data; int32_t length; int32_t capacity; } CS2StrArr;
typedef struct { double *data; int32_t length; int32_t capacity; } CS2NumArr;

CS2StrArr *cs2_str_num_map_keys(StrNumMap *m) {
    CS2StrArr *a = (CS2StrArr *)malloc(sizeof(CS2StrArr));
    a->data = (char **)malloc(sizeof(char *) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->keys[i];
    return a;
}

CS2NumArr *cs2_str_num_map_values(StrNumMap *m) {
    CS2NumArr *a = (CS2NumArr *)malloc(sizeof(CS2NumArr));
    a->data = (double *)malloc(sizeof(double) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->values[i];
    return a;
}

CS2StrArr *cs2_str_str_map_keys(StrStrMap *m) {
    CS2StrArr *a = (CS2StrArr *)malloc(sizeof(CS2StrArr));
    a->data = (char **)malloc(sizeof(char *) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->keys[i];
    return a;
}

CS2StrArr *cs2_str_str_map_values(StrStrMap *m) {
    CS2StrArr *a = (CS2StrArr *)malloc(sizeof(CS2StrArr));
    a->data = (char **)malloc(sizeof(char *) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->values[i];
    return a;
}

CS2NumArr *cs2_num_num_map_keys(NumNumMap *m) {
    CS2NumArr *a = (CS2NumArr *)malloc(sizeof(CS2NumArr));
    a->data = (double *)malloc(sizeof(double) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->keys[i];
    return a;
}

CS2NumArr *cs2_num_num_map_values(NumNumMap *m) {
    CS2NumArr *a = (CS2NumArr *)malloc(sizeof(CS2NumArr));
    a->data = (double *)malloc(sizeof(double) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->values[i];
    return a;
}

CS2NumArr *cs2_num_str_map_keys(NumStrMap *m) {
    CS2NumArr *a = (CS2NumArr *)malloc(sizeof(CS2NumArr));
    a->data = (double *)malloc(sizeof(double) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->keys[i];
    return a;
}

CS2StrArr *cs2_num_str_map_values(NumStrMap *m) {
    CS2StrArr *a = (CS2StrArr *)malloc(sizeof(CS2StrArr));
    a->data = (char **)malloc(sizeof(char *) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->values[i];
    return a;
}

typedef struct {
    char **keys;
    void **values;
    int32_t length;
    int32_t capacity;
} StrPtrMap;

StrPtrMap *cs2_str_ptr_map_new(void) {
    StrPtrMap *m = (StrPtrMap *)malloc(sizeof(StrPtrMap));
    m->capacity = 8; m->length = 0;
    m->keys = (char **)malloc(sizeof(char *) * m->capacity);
    m->values = (void **)malloc(sizeof(void *) * m->capacity);
    return m;
}

void cs2_str_ptr_map_set(StrPtrMap *m, const char *key, void *val) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx >= 0) { m->values[idx] = val; return; }
    if (m->length >= m->capacity) {
        m->capacity *= 2;
        m->keys = (char **)realloc(m->keys, sizeof(char *) * m->capacity);
        m->values = (void **)realloc(m->values, sizeof(void *) * m->capacity);
    }
    m->keys[m->length] = (char *)key;
    m->values[m->length] = val;
    m->length++;
}

void *cs2_str_ptr_map_get(StrPtrMap *m, const char *key) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    return (idx >= 0) ? m->values[idx] : NULL;
}

int32_t cs2_str_ptr_map_has(StrPtrMap *m, const char *key) {
    return find_str_key(m->keys, m->length, key) >= 0 ? 1 : 0;
}

int32_t cs2_str_ptr_map_delete(StrPtrMap *m, const char *key) {
    int32_t idx = find_str_key(m->keys, m->length, key);
    if (idx < 0) return 0;
    m->length--;
    m->keys[idx] = m->keys[m->length];
    m->values[idx] = m->values[m->length];
    return 1;
}

int32_t cs2_str_ptr_map_size(StrPtrMap *m) { return m->length; }
void cs2_str_ptr_map_clear(StrPtrMap *m) { m->length = 0; }
const char *cs2_str_ptr_map_key_at(StrPtrMap *m, int32_t i) { return m->keys[i]; }
void *cs2_str_ptr_map_value_at(StrPtrMap *m, int32_t i) { return m->values[i]; }

typedef struct {
    double *keys;
    void **values;
    int32_t length;
    int32_t capacity;
} NumPtrMap;

NumPtrMap *cs2_num_ptr_map_new(void) {
    NumPtrMap *m = (NumPtrMap *)malloc(sizeof(NumPtrMap));
    m->capacity = 8; m->length = 0;
    m->keys = (double *)malloc(sizeof(double) * m->capacity);
    m->values = (void **)malloc(sizeof(void *) * m->capacity);
    return m;
}

void cs2_num_ptr_map_set(NumPtrMap *m, double key, void *val) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx >= 0) { m->values[idx] = val; return; }
    if (m->length >= m->capacity) {
        m->capacity *= 2;
        m->keys = (double *)realloc(m->keys, sizeof(double) * m->capacity);
        m->values = (void **)realloc(m->values, sizeof(void *) * m->capacity);
    }
    m->keys[m->length] = key;
    m->values[m->length] = val;
    m->length++;
}

void *cs2_num_ptr_map_get(NumPtrMap *m, double key) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    return (idx >= 0) ? m->values[idx] : NULL;
}

int32_t cs2_num_ptr_map_has(NumPtrMap *m, double key) {
    return find_num_key(m->keys, m->length, key) >= 0 ? 1 : 0;
}

int32_t cs2_num_ptr_map_delete(NumPtrMap *m, double key) {
    int32_t idx = find_num_key(m->keys, m->length, key);
    if (idx < 0) return 0;
    m->length--;
    m->keys[idx] = m->keys[m->length];
    m->values[idx] = m->values[m->length];
    return 1;
}

int32_t cs2_num_ptr_map_size(NumPtrMap *m) { return m->length; }
void cs2_num_ptr_map_clear(NumPtrMap *m) { m->length = 0; }
double cs2_num_ptr_map_key_at(NumPtrMap *m, int32_t i) { return m->keys[i]; }
void *cs2_num_ptr_map_value_at(NumPtrMap *m, int32_t i) { return m->values[i]; }

NumPtrMap *cs2_num_ptr_map_copy(NumPtrMap *src) {
    NumPtrMap *m = cs2_num_ptr_map_new();
    for (int32_t i = 0; i < src->length; i++) cs2_num_ptr_map_set(m, src->keys[i], src->values[i]);
    return m;
}

CS2NumArr *cs2_num_ptr_map_keys(NumPtrMap *m) {
    CS2NumArr *a = (CS2NumArr *)malloc(sizeof(CS2NumArr));
    a->data = (double *)malloc(sizeof(double) * (m->length < 4 ? 4 : m->length));
    a->length = m->length; a->capacity = m->length < 4 ? 4 : m->length;
    for (int32_t i = 0; i < m->length; i++) a->data[i] = m->keys[i];
    return a;
}
