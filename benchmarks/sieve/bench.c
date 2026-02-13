#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define LIMIT 10000000

int main(void) {
    char *flags = (char *)malloc(LIMIT + 1);
    memset(flags, 1, LIMIT + 1);

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    flags[0] = 0;
    flags[1] = 0;
    for (long p = 2; p * p <= LIMIT; p++) {
        if (flags[p]) {
            for (long m = p * p; m <= LIMIT; m += p) {
                flags[m] = 0;
            }
        }
    }

    int count = 0;
    for (int i = 0; i <= LIMIT; i++) {
        if (flags[i]) count++;
    }

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    printf("Limit:    %d\n", LIMIT);
    printf("Primes:   %d\n", count);
    printf("Time:     %.3fs\n", elapsed);

    free(flags);
    return 0;
}
