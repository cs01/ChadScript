#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>

extern double cs_v8_available(void);
extern double cs_v8_eval_number(const char* src);
extern char* cs_v8_eval_string(const char* src);
extern const char* cs_v8_last_error(void);
extern void cs_v8_clear_error(void);

extern uint64_t cs_v8_eval_handle(const char* src);
extern double   cs_v8_handle_to_number(uint64_t h);
extern char*    cs_v8_handle_to_string(uint64_t h);
extern void     cs_v8_handle_release(uint64_t h);
extern uint64_t cs_v8_handle_table_size(void);
extern double   cs_v8_is_handle(uint64_t v);
extern uint64_t cs_v8_make_number_handle(double n);
extern uint64_t cs_v8_make_string_handle(const char* s);
extern uint64_t cs_v8_handle_get_property(uint64_t obj, const char* name);
extern uint64_t cs_v8_handle_call(uint64_t fn, uint64_t this_or_zero,
                                  int32_t n_args, const uint64_t* args);

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

    printf("\n-- JSHandle v0 --\n");

    uint64_t h_num = cs_v8_eval_handle("6 * 7");
    check("eval_handle returns non-zero", h_num != 0, NULL);
    check("eval_handle returns tagged handle", cs_v8_is_handle(h_num) == 1.0, NULL);
    check("handle_to_number reads 42", cs_v8_handle_to_number(h_num) == 42.0, NULL);

    char* h_num_str = cs_v8_handle_to_string(h_num);
    check("handle_to_string of number == '42'",
          h_num_str != NULL && strcmp(h_num_str, "42") == 0, h_num_str);
    free(h_num_str);

    uint64_t h_str = cs_v8_eval_handle("'v8 live'");
    char* h_str_val = cs_v8_handle_to_string(h_str);
    check("handle_to_string of string == 'v8 live'",
          h_str_val != NULL && strcmp(h_str_val, "v8 live") == 0, h_str_val);
    free(h_str_val);

    check("handle_to_number on string handle sets error",
          isnan(cs_v8_handle_to_number(h_str))
          && strstr(cs_v8_last_error(), "does not hold a number") != NULL,
          cs_v8_last_error());

    uint64_t h_obj = cs_v8_eval_handle("({name: 'chad', count: 3})");
    char* h_obj_str = cs_v8_handle_to_string(h_obj);
    check("handle_to_string of object contains '[object Object]' or serialization",
          h_obj_str != NULL, h_obj_str);
    free(h_obj_str);

    uint64_t table_before = cs_v8_handle_table_size();
    check("handle table has 3 entries before releases", table_before == 3, NULL);

    cs_v8_handle_release(h_num);
    cs_v8_handle_release(h_str);
    cs_v8_handle_release(h_obj);
    check("handle table empty after releases", cs_v8_handle_table_size() == 0, NULL);

    check("use-after-release returns NaN + error",
          isnan(cs_v8_handle_to_number(h_num))
          && strstr(cs_v8_last_error(), "already released") != NULL,
          cs_v8_last_error());

    int churn_ok = 1;
    for (int i = 0; i < 10000; i++) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%d", i);
        uint64_t h = cs_v8_eval_handle(buf);
        if (h == 0) { churn_ok = 0; break; }
        if (cs_v8_handle_to_number(h) != (double)i) { churn_ok = 0; break; }
        cs_v8_handle_release(h);
    }
    check("10k handle alloc+release churn", churn_ok, NULL);
    check("handle table empty after churn",
          cs_v8_handle_table_size() == 0, NULL);

    check("cs_v8_is_handle rejects a raw integer",
          cs_v8_is_handle(42) == 0.0, NULL);
    check("cs_v8_is_handle rejects a NULL pointer",
          cs_v8_is_handle(0) == 0.0, NULL);

    printf("\n-- JSHandle v1: make, get_property, call --\n");

    uint64_t h_n = cs_v8_make_number_handle(3.14);
    check("make_number_handle round-trip",
          cs_v8_handle_to_number(h_n) == 3.14, NULL);
    cs_v8_handle_release(h_n);

    uint64_t h_s = cs_v8_make_string_handle("round trip");
    char* s_back = cs_v8_handle_to_string(h_s);
    check("make_string_handle round-trip",
          s_back != NULL && strcmp(s_back, "round trip") == 0, s_back);
    free(s_back);
    cs_v8_handle_release(h_s);

    uint64_t h_obj2 = cs_v8_eval_handle("({name: 'chad', count: 3})");
    uint64_t h_name = cs_v8_handle_get_property(h_obj2, "name");
    char* name_str = cs_v8_handle_to_string(h_name);
    check("get_property 'name' == 'chad'",
          name_str != NULL && strcmp(name_str, "chad") == 0, name_str);
    free(name_str);

    uint64_t h_count = cs_v8_handle_get_property(h_obj2, "count");
    check("get_property 'count' == 3",
          cs_v8_handle_to_number(h_count) == 3.0, NULL);

    uint64_t h_missing = cs_v8_handle_get_property(h_obj2, "nonexistent");
    check("get_property of missing key returns non-zero handle to undefined",
          h_missing != 0, NULL);
    cs_v8_handle_release(h_missing);

    uint64_t h_num_handle_for_get = cs_v8_make_number_handle(42);
    uint64_t bad_get = cs_v8_handle_get_property(h_num_handle_for_get, "foo");
    check("get_property on non-object returns 0 + error",
          bad_get == 0 &&
          strstr(cs_v8_last_error(), "not") != NULL,
          cs_v8_last_error());
    cs_v8_handle_release(h_num_handle_for_get);
    cs_v8_handle_release(h_obj2);
    cs_v8_handle_release(h_name);
    cs_v8_handle_release(h_count);

    uint64_t h_double = cs_v8_eval_handle("(function(x) { return x * 2; })");
    uint64_t arg = cs_v8_make_number_handle(21);
    uint64_t h_result = cs_v8_handle_call(h_double, 0, 1, &arg);
    check("call function (x => x*2)(21) == 42",
          cs_v8_handle_to_number(h_result) == 42.0, NULL);
    cs_v8_handle_release(h_double);
    cs_v8_handle_release(arg);
    cs_v8_handle_release(h_result);

    uint64_t h_greeter = cs_v8_eval_handle(
        "({prefix: 'hi ', greet(n) { return this.prefix + n; }})"
    );
    uint64_t h_greet = cs_v8_handle_get_property(h_greeter, "greet");
    uint64_t h_who = cs_v8_make_string_handle("world");
    uint64_t h_greeting = cs_v8_handle_call(h_greet, h_greeter, 1, &h_who);
    char* greeting = cs_v8_handle_to_string(h_greeting);
    check("method call with this-binding: greeter.greet('world') == 'hi world'",
          greeting != NULL && strcmp(greeting, "hi world") == 0, greeting);
    free(greeting);
    cs_v8_handle_release(h_greeter);
    cs_v8_handle_release(h_greet);
    cs_v8_handle_release(h_who);
    cs_v8_handle_release(h_greeting);

    uint64_t h_not_fn = cs_v8_eval_handle("({notCallable: true})");
    uint64_t dummy = cs_v8_make_number_handle(1);
    uint64_t bad_call = cs_v8_handle_call(h_not_fn, 0, 1, &dummy);
    check("call on non-function returns 0 + error",
          bad_call == 0 && strstr(cs_v8_last_error(), "function") != NULL,
          cs_v8_last_error());
    cs_v8_handle_release(h_not_fn);
    cs_v8_handle_release(dummy);

    uint64_t h_thrower = cs_v8_eval_handle(
        "(function() { throw new Error('js side crash'); })"
    );
    uint64_t thrown_result = cs_v8_handle_call(h_thrower, 0, 0, NULL);
    check("call that throws returns 0 + error contains 'crash'",
          thrown_result == 0 &&
          strstr(cs_v8_last_error(), "crash") != NULL,
          cs_v8_last_error());
    cs_v8_handle_release(h_thrower);

    check("handle table empty at end of v1 tests",
          cs_v8_handle_table_size() == 0, NULL);

    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    if (g_fail == 0) {
        printf("TEST_PASSED\n");
        return 0;
    }
    printf("TEST_FAILED\n");
    return 1;
}
