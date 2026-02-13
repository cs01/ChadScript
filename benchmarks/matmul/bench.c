#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define N 512

int main() {
    double *a = (double *)malloc(N * N * sizeof(double));
    double *b = (double *)malloc(N * N * sizeof(double));
    double *c = (double *)calloc(N * N, sizeof(double));

    for (int i = 0; i < N * N; i++) {
        a[i] = (i % N) + 0.1;
        b[i] = (i / N) + 0.1;
    }

    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    for (int row = 0; row < N; row++) {
        for (int col = 0; col < N; col++) {
            double sum = 0.0;
            for (int k = 0; k < N; k++) {
                sum += a[row * N + k] * b[k * N + col];
            }
            c[row * N + col] = sum;
        }
    }

    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed = (end.tv_sec - start.tv_sec) + (end.tv_nsec - start.tv_nsec) / 1e9;
    double gflops = (2.0 * N * N * N) / elapsed / 1e9;
    printf("Size:     %dx%d\n", N, N);
    printf("Time:     %.3fs\n", elapsed);
    printf("GFLOPS:   %.2f\n", gflops);
    printf("Check:    %.2f\n", c[0]);

    free(a);
    free(b);
    free(c);
    return 0;
}
