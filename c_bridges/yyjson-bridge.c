#include "yyjson.h"
#include <stdlib.h>
#include <string.h>

#define MAX_DOCS 4096

static yyjson_doc *doc_table[MAX_DOCS];
static yyjson_val *root_table[MAX_DOCS];
static int doc_count = 0;

static int store_doc(yyjson_doc *doc, yyjson_val *root) {
    if (doc_count >= MAX_DOCS) return -1;
    doc_table[doc_count] = doc;
    root_table[doc_count] = root;
    doc_count++;
    return doc_count - 1;
}

static yyjson_doc *find_doc(yyjson_val *root) {
    for (int i = doc_count - 1; i >= 0; i--) {
        if (root_table[i] == root) return doc_table[i];
    }
    return NULL;
}

void *csyyjson_parse(const char *str) {
    if (!str) return NULL;
    yyjson_doc *doc = yyjson_read(str, strlen(str), 0);
    if (!doc) return NULL;
    yyjson_val *root = yyjson_doc_get_root(doc);
    if (!root) { yyjson_doc_free(doc); return NULL; }
    store_doc(doc, root);
    return (void *)root;
}

void csyyjson_free(void *root) {
    if (!root) return;
    yyjson_doc *doc = find_doc((yyjson_val *)root);
    if (doc) {
        for (int i = 0; i < doc_count; i++) {
            if (root_table[i] == (yyjson_val *)root) {
                doc_table[i] = doc_table[doc_count - 1];
                root_table[i] = root_table[doc_count - 1];
                doc_count--;
                break;
            }
        }
        yyjson_doc_free(doc);
    }
}

void *csyyjson_obj_get(void *obj, const char *key) {
    if (!obj || !key) return NULL;
    return (void *)yyjson_obj_get((yyjson_val *)obj, key);
}

const char *csyyjson_get_str(void *val) {
    if (!val) return NULL;
    return yyjson_get_str((yyjson_val *)val);
}

double csyyjson_get_num(void *val) {
    if (!val) return 0.0;
    return yyjson_get_num((yyjson_val *)val);
}

int csyyjson_is_true(void *val) {
    if (!val) return 0;
    return yyjson_is_true((yyjson_val *)val) ? 1 : 0;
}

int csyyjson_is_num(void *val) {
    if (!val) return 0;
    return yyjson_is_num((yyjson_val *)val) ? 1 : 0;
}

int csyyjson_is_obj(void *val) {
    if (!val) return 0;
    return yyjson_is_obj((yyjson_val *)val) ? 1 : 0;
}

int csyyjson_arr_size(void *arr) {
    if (!arr) return 0;
    return (int)yyjson_arr_size((yyjson_val *)arr);
}

void *csyyjson_arr_get(void *arr, int idx) {
    if (!arr) return NULL;
    return (void *)yyjson_arr_get((yyjson_val *)arr, (size_t)idx);
}

char *csyyjson_val_write(void *val) {
    if (!val) return NULL;
    size_t len;
    return yyjson_val_write((yyjson_val *)val, 0, &len);
}

void *csyyjson_create_obj(void) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    if (!doc) return NULL;
    yyjson_mut_val *root = yyjson_mut_obj(doc);
    if (!root) { yyjson_mut_doc_free(doc); return NULL; }
    yyjson_mut_doc_set_root(doc, root);
    return (void *)doc;
}

void *csyyjson_create_arr(void) {
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    if (!doc) return NULL;
    yyjson_mut_val *root = yyjson_mut_arr(doc);
    if (!root) { yyjson_mut_doc_free(doc); return NULL; }
    yyjson_mut_doc_set_root(doc, root);
    return (void *)doc;
}

void *csyyjson_mut_arr_add_obj(void *doc, void *arr) {
    if (!doc || !arr) return NULL;
    return (void *)yyjson_mut_arr_add_obj((yyjson_mut_doc *)doc, (yyjson_mut_val *)arr);
}

void csyyjson_arr_add_str(void *doc, void *arr, const char *val) {
    if (!doc || !arr) return;
    yyjson_mut_arr_add_str((yyjson_mut_doc *)doc, (yyjson_mut_val *)arr, val ? val : "");
}

void csyyjson_arr_add_num(void *doc, void *arr, double val) {
    if (!doc || !arr) return;
    if (val == (double)(int64_t)val && val >= -9007199254740992.0 && val <= 9007199254740992.0) {
        yyjson_mut_arr_add_int((yyjson_mut_doc *)doc, (yyjson_mut_val *)arr, (int64_t)val);
    } else {
        yyjson_mut_arr_add_real((yyjson_mut_doc *)doc, (yyjson_mut_val *)arr, val);
    }
}

void *csyyjson_mut_get_root(void *doc) {
    if (!doc) return NULL;
    return (void *)yyjson_mut_doc_get_root((yyjson_mut_doc *)doc);
}

void csyyjson_obj_add_str(void *doc, void *obj, const char *key, const char *val) {
    if (!doc || !obj || !key) return;
    yyjson_mut_obj_add_str((yyjson_mut_doc *)doc, (yyjson_mut_val *)obj, key, val);
}

void csyyjson_obj_add_num(void *doc, void *obj, const char *key, double val) {
    if (!doc || !obj || !key) return;
    if (val == (double)(int64_t)val && val >= -9007199254740992.0 && val <= 9007199254740992.0) {
        yyjson_mut_obj_add_int((yyjson_mut_doc *)doc, (yyjson_mut_val *)obj, key, (int64_t)val);
    } else {
        yyjson_mut_obj_add_real((yyjson_mut_doc *)doc, (yyjson_mut_val *)obj, key, val);
    }
}

void csyyjson_obj_add_bool(void *doc, void *obj, const char *key, int val) {
    if (!doc || !obj || !key) return;
    yyjson_mut_obj_add_bool((yyjson_mut_doc *)doc, (yyjson_mut_val *)obj, key, val ? true : false);
}

void *csyyjson_obj_add_obj(void *doc, void *parent_obj, const char *key) {
    if (!doc || !parent_obj || !key) return NULL;
    yyjson_mut_doc *mdoc = (yyjson_mut_doc *)doc;
    yyjson_mut_val *child = yyjson_mut_obj(mdoc);
    if (!child) return NULL;
    yyjson_mut_obj_add_val(mdoc, (yyjson_mut_val *)parent_obj, key, child);
    return (void *)child;
}

char *csyyjson_stringify(void *doc) {
    if (!doc) return NULL;
    size_t len;
    char *result = yyjson_mut_write((yyjson_mut_doc *)doc, 0, &len);
    yyjson_mut_doc_free((yyjson_mut_doc *)doc);
    return result;
}

char *csyyjson_stringify_pretty(void *doc, int spaces) {
    if (!doc) return NULL;
    size_t len;
    yyjson_write_flag flags = (spaces == 2) ? YYJSON_WRITE_PRETTY_TWO_SPACES : YYJSON_WRITE_PRETTY;
    char *result = yyjson_mut_write((yyjson_mut_doc *)doc, flags, &len);
    yyjson_mut_doc_free((yyjson_mut_doc *)doc);
    return result;
}
