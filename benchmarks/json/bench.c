#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "yyjson.h"

#define COUNT 100000

typedef struct {
    int id;
    char name[32];
    double value;
    int active;
} Item;

int main(void) {
    char **json_strings = (char **)malloc(COUNT * sizeof(char *));
    for (int i = 0; i < COUNT; i++) {
        json_strings[i] = (char *)malloc(128);
        snprintf(json_strings[i], 128,
                 "{\"id\":%d,\"name\":\"item%d\",\"value\":%.2f,\"active\":true}",
                 i, i, i * 3.14);
    }

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    Item *items = (Item *)malloc(COUNT * sizeof(Item));
    for (int i = 0; i < COUNT; i++) {
        yyjson_doc *doc = yyjson_read(json_strings[i], strlen(json_strings[i]), 0);
        yyjson_val *root = yyjson_doc_get_root(doc);
        items[i].id = yyjson_get_int(yyjson_obj_get(root, "id"));
        const char *name = yyjson_get_str(yyjson_obj_get(root, "name"));
        strncpy(items[i].name, name ? name : "", 31);
        items[i].name[31] = '\0';
        items[i].value = yyjson_get_num(yyjson_obj_get(root, "value"));
        items[i].active = yyjson_is_true(yyjson_obj_get(root, "active"));
        yyjson_doc_free(doc);
    }

    char **outputs = (char **)malloc(COUNT * sizeof(char *));
    for (int i = 0; i < COUNT; i++) {
        yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
        yyjson_mut_val *root = yyjson_mut_obj(doc);
        yyjson_mut_doc_set_root(doc, root);
        yyjson_mut_obj_add_int(doc, root, "id", items[i].id);
        yyjson_mut_obj_add_str(doc, root, "name", items[i].name);
        yyjson_mut_obj_add_real(doc, root, "value", items[i].value);
        yyjson_mut_obj_add_bool(doc, root, "active", items[i].active);
        size_t len;
        outputs[i] = yyjson_mut_write(doc, 0, &len);
        yyjson_mut_doc_free(doc);
    }

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    printf("Objects:  %d\n", COUNT);
    printf("Check:    %s\n", items[0].name);
    printf("OutLen:   %zu\n", strlen(outputs[0]));
    printf("Time:     %.3fs\n", elapsed);

    for (int i = 0; i < COUNT; i++) {
        free(json_strings[i]);
        free(outputs[i]);
    }
    free(json_strings);
    free(items);
    free(outputs);
    return 0;
}
