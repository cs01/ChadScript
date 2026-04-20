// C reference: small open-addressing hash map (FNV-1a, linear probe).
// String keys, int values. Same N/Q as the other implementations.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define N 100000
#define Q 1000000
#define CAP (N * 2)

typedef struct {
    char *key;
    int   val;
    int   used;
} Slot;

static Slot table[CAP];

static unsigned long fnv1a(const char *s) {
    unsigned long h = 1469598103934665603UL;
    while (*s) {
        h ^= (unsigned char)*s++;
        h *= 1099511628211UL;
    }
    return h;
}

static void map_set(const char *k, int v) {
    unsigned long h = fnv1a(k) % CAP;
    while (table[h].used) {
        if (strcmp(table[h].key, k) == 0) { table[h].val = v; return; }
        h = (h + 1) % CAP;
    }
    table[h].key = strdup(k);
    table[h].val = v;
    table[h].used = 1;
}

static int map_get(const char *k, int *found) {
    unsigned long h = fnv1a(k) % CAP;
    while (table[h].used) {
        if (strcmp(table[h].key, k) == 0) { *found = 1; return table[h].val; }
        h = (h + 1) % CAP;
    }
    *found = 0;
    return 0;
}

int main(void) {
    char buf[32];
    for (int i = 0; i < N; i++) {
        snprintf(buf, sizeof(buf), "key%d", i);
        map_set(buf, i);
    }

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    long long sum = 0;
    for (int q = 0; q < Q; q++) {
        snprintf(buf, sizeof(buf), "key%d", q % N);
        int found;
        int v = map_get(buf, &found);
        if (found) sum += v;
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    printf("Sum:      %lld\n", sum);
    printf("Time:     %.6fs\n", elapsed);
    return 0;
}
