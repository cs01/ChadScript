#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int g_argc = 0;
static char **g_argv = NULL;

typedef struct {
  char **data;
  int len;
  int cap;
} StrArray;

void cs2_process_init(int argc, char **argv) {
  g_argc = argc;
  g_argv = argv;
}

StrArray *cs2_process_argv_array(void) {
  StrArray *arr = (StrArray *)malloc(sizeof(StrArray));
  int cap = g_argc > 4 ? g_argc : 4;
  arr->data = (char **)malloc(sizeof(char *) * cap);
  arr->len = g_argc;
  arr->cap = cap;
  for (int i = 0; i < g_argc; i++) {
    arr->data[i] = g_argv[i];
  }
  return arr;
}

char *cs2_process_env_get(const char *name) {
  char *val = getenv(name);
  return val ? val : "";
}

char *cs2_process_cwd(void) {
  char *buf = (char *)malloc(4096);
  if (getcwd(buf, 4096)) return buf;
  strcpy(buf, ".");
  return buf;
}

char *cs2_process_platform(void) {
#ifdef __APPLE__
  return "darwin";
#elif __linux__
  return "linux";
#else
  return "unknown";
#endif
}

void cs2_process_exit(int code) { exit(code); }

int64_t cs2_process_get_pid(void) { return (int64_t)getpid(); }
