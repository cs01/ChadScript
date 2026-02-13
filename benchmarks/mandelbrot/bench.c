#include <stdio.h>
#include <time.h>

#define W 4096
#define H 4096
#define MAX_ITER 100

int main() {
    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    long totalIter = 0;

    for (int py = 0; py < H; py++) {
        for (int px = 0; px < W; px++) {
            double x0 = (px * 3.5) / W - 2.5;
            double y0 = (py * 2.0) / H - 1.0;
            double x = 0.0, y = 0.0;
            int iter = 0;
            while (iter < MAX_ITER && x * x + y * y <= 4.0) {
                double t = x * x - y * y + x0;
                y = 2.0 * x * y + y0;
                x = t;
                iter++;
            }
            totalIter += iter;
        }
    }

    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed = (end.tv_sec - start.tv_sec) + (end.tv_nsec - start.tv_nsec) / 1e9;
    printf("Size:     %dx%d\n", W, H);
    printf("Time:     %.3fs\n", elapsed);
    printf("Iters:    %ld\n", totalIter);
    return 0;
}
