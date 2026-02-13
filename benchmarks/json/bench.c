#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <cjson/cJSON.h>

#define COUNT 10000

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
        cJSON *root = cJSON_Parse(json_strings[i]);
        items[i].id = cJSON_GetObjectItem(root, "id")->valueint;
        strncpy(items[i].name, cJSON_GetObjectItem(root, "name")->valuestring, 31);
        items[i].name[31] = '\0';
        items[i].value = cJSON_GetObjectItem(root, "value")->valuedouble;
        items[i].active = cJSON_IsTrue(cJSON_GetObjectItem(root, "active"));
        cJSON_Delete(root);
    }

    char **outputs = (char **)malloc(COUNT * sizeof(char *));
    for (int i = 0; i < COUNT; i++) {
        cJSON *root = cJSON_CreateObject();
        cJSON_AddNumberToObject(root, "id", items[i].id);
        cJSON_AddStringToObject(root, "name", items[i].name);
        cJSON_AddNumberToObject(root, "value", items[i].value);
        cJSON_AddBoolToObject(root, "active", items[i].active);
        outputs[i] = cJSON_PrintUnformatted(root);
        cJSON_Delete(root);
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
