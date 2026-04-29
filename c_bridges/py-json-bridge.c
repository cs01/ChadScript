#include "yyjson.h"
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

static char *json_pythonify(char *compact) {
    if (!compact) return compact;
    size_t len = strlen(compact);
    size_t extra = 0;
    int in_str = 0;
    char prev = 0;
    for (size_t i = 0; i < len; i++) {
        char c = compact[i];
        if (c == '"' && prev != '\\') in_str = !in_str;
        if (!in_str && (c == ',' || c == ':')) extra++;
        prev = c;
    }
    if (!extra) return compact;
    char *out = (char *)malloc(len + extra + 1);
    size_t j = 0;
    in_str = 0; prev = 0;
    for (size_t i = 0; i < len; i++) {
        char c = compact[i];
        if (c == '"' && prev != '\\') in_str = !in_str;
        out[j++] = c;
        if (!in_str && (c == ',' || c == ':')) out[j++] = ' ';
        prev = c;
    }
    out[j] = '\0';
    free(compact);
    return out;
}

typedef struct { double *data; int32_t length; int32_t capacity; } NumArray;
typedef struct { char **data; int32_t length; int32_t capacity; } StrArray;
typedef struct { char **keys; double *values; int32_t length; int32_t capacity; } StrNumMap;
typedef struct { char **keys; char **values; int32_t length; int32_t capacity; } StrStrMap;

extern StrStrMap *cs2_str_str_map_new(void);
extern void cs2_str_str_map_set(StrStrMap *m, const char *k, const char *v);
extern StrNumMap *cs2_str_num_map_new(void);
extern void cs2_str_num_map_set(StrNumMap *m, const char *k, double v);
extern NumArray *cs2_num_array_new(int32_t capacity);
extern void cs2_num_array_push(NumArray *arr, double value);
extern StrArray *cs2_str_array_new(int32_t capacity);
extern void cs2_str_array_push(StrArray *arr, const char *s);

char *cs2_py_json_dumps_str_str_map(StrStrMap *m) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_obj(doc);
    yyjson_mut_doc_set_root(doc, root);
    for (int i = 0; i < m->length; i++)
        yyjson_mut_obj_add_str(doc, root, m->keys[i], m->values[i]);
    size_t len;
    char *r = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return json_pythonify(r);
}

char *cs2_py_json_dumps_str_num_map(StrNumMap *m) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_obj(doc);
    yyjson_mut_doc_set_root(doc, root);
    for (int i = 0; i < m->length; i++) {
        double v = m->values[i];
        if (v == (double)(int64_t)v)
            yyjson_mut_obj_add_int(doc, root, m->keys[i], (int64_t)v);
        else
            yyjson_mut_obj_add_real(doc, root, m->keys[i], v);
    }
    size_t len;
    char *r = yyjson_mut_write(doc, 0, &len);
    yyjson_mut_doc_free(doc);
    return json_pythonify(r);
}

extern char *cs2_json_stringify_str_array(void *arr);
extern char *cs2_json_stringify_num_array(void *arr);

char *cs2_py_json_dumps_str_array(StrArray *arr) {
    return json_pythonify(cs2_json_stringify_str_array(arr));
}

char *cs2_py_json_dumps_num_array(NumArray *arr) {
    return json_pythonify(cs2_json_stringify_num_array(arr));
}

StrStrMap *cs2_py_json_loads_str_str_map(const char *s) {
    StrStrMap *m = cs2_str_str_map_new();
    if (!s) return m;
    yyjson_doc *doc = yyjson_read(s, strlen(s), 0);
    if (!doc) return m;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (yyjson_is_obj(root)) {
        yyjson_obj_iter iter = yyjson_obj_iter_with(root);
        yyjson_val *key;
        while ((key = yyjson_obj_iter_next(&iter))) {
            yyjson_val *val = yyjson_obj_iter_get_val(key);
            const char *k = yyjson_get_str(key);
            const char *v = yyjson_is_str(val) ? yyjson_get_str(val) : "";
            if (k) cs2_str_str_map_set(m, strdup(k), strdup(v));
        }
    }
    yyjson_doc_free(doc);
    return m;
}

StrNumMap *cs2_py_json_loads_str_num_map(const char *s) {
    StrNumMap *m = cs2_str_num_map_new();
    if (!s) return m;
    yyjson_doc *doc = yyjson_read(s, strlen(s), 0);
    if (!doc) return m;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (yyjson_is_obj(root)) {
        yyjson_obj_iter iter = yyjson_obj_iter_with(root);
        yyjson_val *key;
        while ((key = yyjson_obj_iter_next(&iter))) {
            yyjson_val *val = yyjson_obj_iter_get_val(key);
            const char *k = yyjson_get_str(key);
            double v = yyjson_is_num(val) ? yyjson_get_num(val) : 0.0;
            if (k) cs2_str_num_map_set(m, strdup(k), v);
        }
    }
    yyjson_doc_free(doc);
    return m;
}

StrArray *cs2_py_json_loads_str_array(const char *s) {
    StrArray *arr = cs2_str_array_new(8);
    if (!s) return arr;
    yyjson_doc *doc = yyjson_read(s, strlen(s), 0);
    if (!doc) return arr;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (yyjson_is_arr(root)) {
        size_t idx, max; yyjson_val *val;
        yyjson_arr_foreach(root, idx, max, val)
            cs2_str_array_push(arr, yyjson_is_str(val) ? strdup(yyjson_get_str(val)) : "");
    }
    yyjson_doc_free(doc);
    return arr;
}

NumArray *cs2_py_json_loads_num_array(const char *s) {
    NumArray *arr = cs2_num_array_new(8);
    if (!s) return arr;
    yyjson_doc *doc = yyjson_read(s, strlen(s), 0);
    if (!doc) return arr;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (yyjson_is_arr(root)) {
        size_t idx, max; yyjson_val *val;
        yyjson_arr_foreach(root, idx, max, val)
            cs2_num_array_push(arr, yyjson_is_num(val) ? yyjson_get_num(val) : 0.0);
    }
    yyjson_doc_free(doc);
    return arr;
}
