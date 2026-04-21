#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <mach/mach.h>

extern double cs_v8_available(void);
extern double cs_v8_eval_number(const char* src);
extern char* cs_v8_eval_string(const char* src);

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1.0e6;
}

static size_t rss_bytes(void) {
    mach_task_basic_info_data_t info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                  (task_info_t)&info, &count) != KERN_SUCCESS) {
        return 0;
    }
    return (size_t)info.resident_size;
}

static double mb(size_t b) { return b / (1024.0 * 1024.0); }

int main(void) {
    printf("v8 bridge phase 0 benchmarks\n");
    printf("============================\n\n");

    size_t rss_startup = rss_bytes();
    printf("RSS at process start (before any v8 call): %.2f MB\n", mb(rss_startup));

    double t0 = now_ms();
    double warm = cs_v8_eval_number("1");
    double t1 = now_ms();
    printf("V8 cold init + first eval: %.2f ms (result=%g)\n", t1 - t0, warm);

    size_t rss_after_init = rss_bytes();
    printf("RSS after v8 init: %.2f MB (+%.2f MB)\n",
           mb(rss_after_init), mb(rss_after_init - rss_startup));

    printf("\n-- eval_number throughput --\n");
    const int N_NUM = 100000;
    t0 = now_ms();
    double sum = 0;
    for (int i = 0; i < N_NUM; i++) {
        sum += cs_v8_eval_number("2 + 2");
    }
    t1 = now_ms();
    double num_elapsed_ms = t1 - t0;
    double num_ops_per_sec = (N_NUM * 1000.0) / num_elapsed_ms;
    double num_us_per_op = (num_elapsed_ms * 1000.0) / N_NUM;
    printf("  %d evals in %.0f ms → %.0f ops/sec → %.2f µs/op  (sum=%g)\n",
           N_NUM, num_elapsed_ms, num_ops_per_sec, num_us_per_op, sum);

    printf("\n-- eval_string throughput --\n");
    const int N_STR = 100000;
    t0 = now_ms();
    size_t total_len = 0;
    for (int i = 0; i < N_STR; i++) {
        char* s = cs_v8_eval_string("'ok'");
        if (s) {
            total_len += strlen(s);
            free(s);
        }
    }
    t1 = now_ms();
    double str_elapsed_ms = t1 - t0;
    double str_ops_per_sec = (N_STR * 1000.0) / str_elapsed_ms;
    double str_us_per_op = (str_elapsed_ms * 1000.0) / N_STR;
    printf("  %d evals in %.0f ms → %.0f ops/sec → %.2f µs/op  (total_len=%zu)\n",
           N_STR, str_elapsed_ms, str_ops_per_sec, str_us_per_op, total_len);

    printf("\n-- memory stability: 1M evals with RSS samples --\n");
    const int N_LEAK = 1000000;
    const int SAMPLE_EVERY = 100000;
    size_t rss_before_leak = rss_bytes();
    printf("  RSS before loop: %.2f MB\n", mb(rss_before_leak));
    t0 = now_ms();
    double acc = 0;
    for (int i = 0; i < N_LEAK; i++) {
        acc += cs_v8_eval_number("1 + 1");
        if (i > 0 && i % SAMPLE_EVERY == 0) {
            size_t r = rss_bytes();
            double delta = (double)r - (double)rss_before_leak;
            printf("  after %7d evals: RSS %.2f MB (%+.2f MB vs start)\n",
                   i, mb(r), delta / (1024.0 * 1024.0));
        }
    }
    t1 = now_ms();
    size_t rss_after_leak = rss_bytes();
    double leak_elapsed_ms = t1 - t0;
    double leak_ops_per_sec = (N_LEAK * 1000.0) / leak_elapsed_ms;
    printf("  1M evals in %.0f ms → %.0f ops/sec (acc=%g)\n",
           leak_elapsed_ms, leak_ops_per_sec, acc);
    printf("  RSS delta across 1M evals: %+.2f MB\n",
           ((double)rss_after_leak - (double)rss_before_leak) / (1024.0 * 1024.0));

    printf("\n============================\n");
    printf("BENCH_DONE\n");
    return 0;
}
