#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

extern double cs_v8_available(void);
extern double cs_v8_eval_number(const char* src);
extern char* cs_v8_eval_string(const char* src);
extern const char* cs_v8_last_error(void);
extern void cs_v8_clear_error(void);

static int g_pass = 0;
static int g_fail = 0;

static void check(const char* name, int ok, const char* extra) {
    if (ok) {
        printf("  PASS: %s\n", name);
        g_pass++;
    } else {
        printf("  FAIL: %s  (%s)\n", name, extra ? extra : "");
        g_fail++;
    }
}

int main(void) {
    printf("v8 bridge unit tests\n");

    check("v8 available", cs_v8_available() == 1.0, NULL);

    double n = cs_v8_eval_number("1 + 2 * 3");
    check("happy number: 1+2*3 = 7", n == 7.0, NULL);
    check("no error set after happy number", strlen(cs_v8_last_error()) == 0, cs_v8_last_error());

    char* s = cs_v8_eval_string("'hello ' + 'v8'");
    check("happy string: concat", s != NULL && strcmp(s, "hello v8") == 0, s);
    free(s);

    double thrown = cs_v8_eval_number("throw new Error('oops')");
    check("throw returns NaN", isnan(thrown), NULL);
    check("throw error message contains 'oops'",
          strstr(cs_v8_last_error(), "oops") != NULL, cs_v8_last_error());

    double syntax = cs_v8_eval_number("1 +");
    check("syntax error returns NaN", isnan(syntax), NULL);
    check("syntax error message contains 'SyntaxError'",
          strstr(cs_v8_last_error(), "SyntaxError") != NULL, cs_v8_last_error());

    double wrong = cs_v8_eval_number("'hello'");
    check("type mismatch returns NaN", isnan(wrong), NULL);
    check("type mismatch message contains 'expected number'",
          strstr(cs_v8_last_error(), "expected number") != NULL, cs_v8_last_error());

    cs_v8_clear_error();
    double recovered = cs_v8_eval_number("42");
    check("recovery after error: eval 42", recovered == 42.0, NULL);
    check("error cleared after successful eval",
          strlen(cs_v8_last_error()) == 0, cs_v8_last_error());

    char* str_throw = cs_v8_eval_string("throw new Error('string oops')");
    check("eval_string returns NULL on throw", str_throw == NULL, NULL);
    check("string throw error contains 'string oops'",
          strstr(cs_v8_last_error(), "string oops") != NULL, cs_v8_last_error());

    int seq_ok = 1;
    for (int i = 0; i < 1000; i++) {
        char buf[64];
        snprintf(buf, sizeof(buf), "%d * 2", i);
        double r = cs_v8_eval_number(buf);
        if (r != (double)(i * 2)) { seq_ok = 0; break; }
    }
    check("1000 sequential evals state clean", seq_ok, NULL);

    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    if (g_fail == 0) {
        printf("TEST_PASSED\n");
        return 0;
    }
    printf("TEST_FAILED\n");
    return 1;
}
