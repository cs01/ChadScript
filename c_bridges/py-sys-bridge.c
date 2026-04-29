#include <stdlib.h>
#include <string.h>

static int cs2_argc_g = 0;
static char **cs2_argv_g = NULL;

void cs2_py_set_argv(int argc, char **argv) {
    cs2_argc_g = argc;
    cs2_argv_g = argv;
}

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} CS2StrArray;

extern CS2StrArray *cs2_str_array_new(int32_t capacity);
extern void cs2_str_array_push(CS2StrArray *arr, const char *s);

CS2StrArray *cs2_py_sys_argv(void) {
    CS2StrArray *arr = cs2_str_array_new(cs2_argc_g > 0 ? cs2_argc_g : 1);
    for (int i = 0; i < cs2_argc_g; i++) {
        cs2_str_array_push(arr, cs2_argv_g[i]);
    }
    return arr;
}

void cs2_py_sys_exit(int64_t code) {
    exit((int)code);
}

int32_t cs2_py_sys_argc(void) {
    return cs2_argc_g;
}

const char *cs2_py_sys_argv_at(int32_t i) {
    if (i < 0 || i >= cs2_argc_g) return "";
    return cs2_argv_g[i];
}
