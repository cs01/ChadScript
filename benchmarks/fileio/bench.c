#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define CHUNK_SIZE (100 * 1024)
#define CHUNKS 1024
#define FILE_PATH "/tmp/bench-fileio-test.dat"

int main(void) {
    char *chunk = (char *)malloc(CHUNK_SIZE);
    memset(chunk, 'A', CHUNK_SIZE);

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    FILE *fw = fopen(FILE_PATH, "wb");
    for (int i = 0; i < CHUNKS; i++) {
        fwrite(chunk, 1, CHUNK_SIZE, fw);
    }
    fclose(fw);

    long total_size = (long)CHUNK_SIZE * CHUNKS;

    char *buf = (char *)malloc(total_size);
    FILE *fr = fopen(FILE_PATH, "rb");
    long read_bytes = fread(buf, 1, total_size, fr);
    fclose(fr);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    unlink(FILE_PATH);

    printf("Written:  %ld\n", total_size);
    printf("Read:     %ld\n", read_bytes);
    printf("Time:     %.3fs\n", elapsed);

    free(chunk);
    free(buf);
    return 0;
}
