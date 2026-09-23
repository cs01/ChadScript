// The collector's ASan annotations must make a read of a collected object a report (the sanitized
// lane's coverage of the GC heap rests on it). Allocates a string, hides the only pointer to it
// from the conservative scan (XOR-masked in a global, stack wiped), collects, then reads it through
// the ASan-instrumented Milo runtime. Built with CHAD_SAN=1 this must abort; without ASan the read
// is of an unreused free line and the harness exits 0 (the test runner only runs it sanitized).
#include <stdint.h>
#include <stdio.h>
#include <string.h>

void cs_gc_init(void);
void cs_gc_collect(void);
void *cs_str_from(const char *data, int64_t len);
int32_t cs_str_len(void *s);

#define MASK 0x5a5a5a5a5a5a5a5aull
static volatile uint64_t hidden;

__attribute__((noinline)) static void make_garbage(void) {
  hidden = (uint64_t)(uintptr_t)cs_str_from("dangling", 8) ^ MASK;
  // Nothing else is allocated: its line holds no other object, so nothing else keeps it marked.
}

__attribute__((noinline)) static void wipe_stack(void) {
  volatile char junk[8192];
  memset((char *)junk, 0, sizeof junk);
}

int main(void) {
  cs_gc_init();
  make_garbage();
  wipe_stack();
  cs_gc_collect();
  void *s = (void *)(uintptr_t)(hidden ^ MASK);
  printf("len %d\n", cs_str_len(s));
  return 0;
}
