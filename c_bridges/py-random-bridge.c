#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

static int cs2_random_seeded = 0;

static void cs2_random_seed_once(void) {
    if (!cs2_random_seeded) {
        srand((unsigned)time(NULL));
        cs2_random_seeded = 1;
    }
}

double cs2_random_random(void) {
    cs2_random_seed_once();
    return (double)rand() / ((double)RAND_MAX + 1.0);
}

int64_t cs2_random_randint(int64_t a, int64_t b) {
    cs2_random_seed_once();
    int64_t range = b - a + 1;
    if (range <= 0) return a;
    return a + (int64_t)(rand() % (int)range);
}

double cs2_random_uniform(double a, double b) {
    cs2_random_seed_once();
    double r = (double)rand() / ((double)RAND_MAX + 1.0);
    return a + r * (b - a);
}

void cs2_random_seed(int64_t s) {
    srand((unsigned)s);
    cs2_random_seeded = 1;
}

typedef struct { double *data; int32_t length; int32_t capacity; } NumArray;
typedef struct { char **data; int32_t length; int32_t capacity; } StrArray;

double cs2_random_choice_num(NumArray *arr) {
    cs2_random_seed_once();
    if (arr->length == 0) return 0.0;
    return arr->data[rand() % arr->length];
}

char *cs2_random_choice_str(StrArray *arr) {
    cs2_random_seed_once();
    if (arr->length == 0) return "";
    return arr->data[rand() % arr->length];
}

void cs2_random_shuffle_num(NumArray *arr) {
    cs2_random_seed_once();
    for (int32_t i = arr->length - 1; i > 0; i--) {
        int32_t j = rand() % (i + 1);
        double tmp = arr->data[i];
        arr->data[i] = arr->data[j];
        arr->data[j] = tmp;
    }
}
