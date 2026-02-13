#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

#define COUNT 100000

int main(void) {
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    size_t cap = 1024 * 1024;
    char *big = (char *)malloc(cap);
    size_t len = 0;
    big[0] = '\0';

    for (int i = 0; i < COUNT; i++) {
        char item[32];
        int n = snprintf(item, sizeof(item), "%sitem%d", i > 0 ? "," : "", i);
        if (len + n + 1 > cap) {
            cap *= 2;
            big = (char *)realloc(big, cap);
        }
        memcpy(big + len, item, n + 1);
        len += n;
    }

    char *result = (char *)malloc(len * 2 + 1);
    size_t rlen = 0;
    char *p = big;
    int first = 1;
    while (*p) {
        char *comma = strchr(p, ',');
        size_t toklen = comma ? (size_t)(comma - p) : strlen(p);

        if (!first) {
            result[rlen++] = ',';
        }
        first = 0;

        for (size_t k = 0; k < toklen; k++) {
            result[rlen++] = toupper((unsigned char)p[k]);
        }

        if (!comma) break;
        p = comma + 1;
    }
    result[rlen] = '\0';

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    printf("Strings:  %d\n", COUNT);
    printf("Length:   %zu\n", rlen);
    printf("Time:     %.3fs\n", elapsed);

    free(big);
    free(result);
    return 0;
}
