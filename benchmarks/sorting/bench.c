#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define N 2000000

void quicksort(double *arr, int lo, int hi) {
    if (lo >= hi) return;
    double pivot = arr[hi];
    int i = lo;
    for (int j = lo; j < hi; j++) {
        if (arr[j] < pivot) {
            double tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
            i++;
        }
    }
    double tmp = arr[i];
    arr[i] = arr[hi];
    arr[hi] = tmp;
    quicksort(arr, lo, i - 1);
    quicksort(arr, i + 1, hi);
}

int main(void) {
    double *arr = (double *)malloc(N * sizeof(double));
    long seed = 42;
    for (int i = 0; i < N; i++) {
        seed = (seed * 16807) % 2147483647;
        arr[i] = (double)seed / 2147483647.0;
    }

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    quicksort(arr, 0, N - 1);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    printf("Elements: %d\n", N);
    printf("First:    %.15f\n", arr[0]);
    printf("Last:     %.15f\n", arr[N - 1]);
    printf("Time:     %.3fs\n", elapsed);

    free(arr);
    return 0;
}
