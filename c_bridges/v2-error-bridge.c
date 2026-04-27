#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_TRY_DEPTH 64

static jmp_buf try_stack[MAX_TRY_DEPTH];
static int try_top = -1;
static const char *thrown_msg = NULL;

void *cs2_try_enter(void) {
    try_top++;
    return (void *)&try_stack[try_top];
}

void cs2_try_leave(void) {
    if (try_top >= 0) try_top--;
}

void cs2_throw(const char *msg) {
    thrown_msg = msg;
    if (try_top >= 0) {
        int top = try_top;
        longjmp(try_stack[top], 1);
    } else {
        fprintf(stderr, "Uncaught: %s\n", msg);
        exit(1);
    }
}

const char *cs2_catch_msg(void) {
    return thrown_msg ? thrown_msg : "";
}
