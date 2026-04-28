#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_TIMERS 64

static struct {
  char *label;
  struct timespec start;
} timers[MAX_TIMERS];
static int timer_count = 0;

void cs2_console_time(const char *label) {
  for (int i = 0; i < timer_count; i++) {
    if (strcmp(timers[i].label, label) == 0) {
      clock_gettime(CLOCK_MONOTONIC, &timers[i].start);
      return;
    }
  }
  if (timer_count >= MAX_TIMERS) return;
  timers[timer_count].label = strdup(label);
  clock_gettime(CLOCK_MONOTONIC, &timers[timer_count].start);
  timer_count++;
}

void cs2_console_time_end(const char *label) {
  struct timespec end;
  clock_gettime(CLOCK_MONOTONIC, &end);
  for (int i = 0; i < timer_count; i++) {
    if (strcmp(timers[i].label, label) == 0) {
      double ms = (end.tv_sec - timers[i].start.tv_sec) * 1000.0 +
                  (end.tv_nsec - timers[i].start.tv_nsec) / 1000000.0;
      fprintf(stderr, "%s: %.3fms\n", label, ms);
      return;
    }
  }
}

void cs2_stderr_str(const char *s) { fprintf(stderr, "%s", s); }

void cs2_stderr_str_nl(const char *s) { fprintf(stderr, "%s\n", s); }

static void format_number_stderr(double val) {
  if (val == 0.0 && signbit(val)) {
    fprintf(stderr, "0");
    return;
  }
  if (isinf(val)) {
    fprintf(stderr, "%sInfinity", val < 0 ? "-" : "");
    return;
  }
  if (isnan(val)) {
    fprintf(stderr, "NaN");
    return;
  }
  double intpart;
  if (modf(val, &intpart) == 0.0 && fabs(val) < 1e15) {
    long long iv = (long long)val;
    fprintf(stderr, "%lld", iv);
  } else {
    char buf[64];
    snprintf(buf, sizeof(buf), "%.17g", val);
    int len = strlen(buf);
    if (strchr(buf, '.')) {
      while (len > 1 && buf[len - 1] == '0') buf[--len] = '\0';
      if (len > 1 && buf[len - 1] == '.') buf[--len] = '\0';
    }
    fprintf(stderr, "%s", buf);
  }
}

void cs2_stderr_number(double n) { format_number_stderr(n); }

void cs2_stderr_i64(long long n) { fprintf(stderr, "%lld", n); }

void cs2_stderr_bool(int b) { fprintf(stderr, "%s", b ? "true" : "false"); }

void cs2_stderr_nl(void) { fputc('\n', stderr); }

void cs2_stderr_space(void) { fputc(' ', stderr); }

void cs2_stderr_boxed(unsigned long long val) {
  extern int nanbox_is_string(unsigned long long);
  extern int nanbox_is_number(unsigned long long);
  extern const char *nanbox_to_string(unsigned long long);
  extern double nanbox_to_f64(unsigned long long);
  if (nanbox_is_string(val)) {
    fprintf(stderr, "%s\n", nanbox_to_string(val));
  } else if (nanbox_is_number(val)) {
    format_number_stderr(nanbox_to_f64(val));
    fputc('\n', stderr);
  } else {
    fprintf(stderr, "undefined\n");
  }
}
