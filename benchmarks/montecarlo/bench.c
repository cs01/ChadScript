#include <stdio.h>
#include <time.h>

#define SAMPLES 50000000

int main(void) {
    long seed = 42;
    long inside = 0;

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    for (long i = 0; i < SAMPLES; i++) {
        seed = (seed * 16807) % 2147483647;
        double x = (double)seed / 2147483647.0;
        seed = (seed * 16807) % 2147483647;
        double y = (double)seed / 2147483647.0;
        if (x * x + y * y <= 1.0) {
            inside++;
        }
    }

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;
    double pi = 4.0 * inside / SAMPLES;

    printf("Samples:  %d\n", SAMPLES);
    printf("Pi:       %.15f\n", pi);
    printf("Time:     %.3fs\n", elapsed);
    return 0;
}
