// C reference: POSIX <regex.h>. Same engine ChadScript used to use.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <regex.h>
#include <time.h>

#define N 100000

int main(void) {
    char **strs = (char **)malloc(N * sizeof(char *));
    for (int i = 0; i < N; i++) {
        strs[i] = (char *)malloc(64);
        snprintf(strs[i], 64, "abc%ddef", i);
    }

    regex_t re;
    if (regcomp(&re, "^[a-z]+([0-9]+)[a-z]*$", REG_EXTENDED) != 0) {
        fprintf(stderr, "regex compile failed\n");
        return 1;
    }

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    int hits = 0;
    for (int i = 0; i < N; i++) {
        if (regexec(&re, strs[i], 0, NULL, 0) == 0) hits++;
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    printf("Matches:  %d\n", hits);
    printf("Time:     %.6fs\n", elapsed);

    regfree(&re);
    return 0;
}
