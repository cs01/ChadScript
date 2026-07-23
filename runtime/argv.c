// process.argv. Node's argv[0] is the node binary and argv[1] is the script path — a compiled
// binary has neither, so those two entries can never both agree with the oracle. Only
// `process.argv.slice(2)` is admitted (the validator rejects any other use), and that slice IS
// exact: it is the user's arguments, byte for byte.
//
// `main` records argc/argv here before anything else runs, because the array is built lazily —
// a program that never reads its arguments pays nothing.

#include "strings.h"
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

typedef struct CsArray CsArray;
extern CsArray *cs_array_new(void);
extern void cs_array_push(CsArray *a, long long slot);

static int cs_argc = 0;
static char **cs_argv = NULL;

void cs_set_args(int argc, char **argv) {
  cs_argc = argc;
  cs_argv = argv;
}

// The length of a NUL-terminated C string. argv strings come from the OS and are genuinely
// NUL-terminated, which is the one place that is true — CsString itself never relies on it.
static size_t cs_cstr_len(const char *s) {
  size_t n = 0;
  while (s[n] != '\0') n++;
  return n;
}

static void cs_die_non_ascii_arg(int index) {
  static const char msg[] =
      "chadscript: argument contains non-ASCII bytes, which this build cannot represent with "
      "JavaScript string semantics (argument index ";
  fwrite(msg, 1, sizeof(msg) - 1, stderr);
  fprintf(stderr, "%d)\n", index);
  exit(1);
}

// `process.argv.slice(2)`: the arguments after the program name. Built fresh on each call, like
// any other array-producing expression.
CsArray *cs_argv_slice2(void) {
  CsArray *out = cs_array_new();
  for (int i = 1; i < cs_argc; i++) {
    const char *raw = cs_argv[i];
    size_t len = cs_cstr_len(raw);
    // Source literals are checked for non-ASCII at compile time (CS1216); the command line is the
    // one runtime path that can smuggle a non-ASCII string in. Accepting it would make .length and
    // every index-based method disagree with Node, so it fails LOUDLY here instead.
    for (size_t j = 0; j < len; j++) {
      if ((unsigned char)raw[j] > 0x7F) {
        cs_die_non_ascii_arg(i);
      }
    }
    CsString *s = cs_str_from(raw, len);
    cs_array_push(out, (long long)(size_t)s);
  }
  return out;
}

// `process.pid`. A JS number, so a double crosses the ABI like every other number — pids fit
// exactly (they are far below 2^53).
double cs_process_pid(void) { return (double)getpid(); }
