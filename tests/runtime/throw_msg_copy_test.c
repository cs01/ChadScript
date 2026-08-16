// cs_new_error / cs_new_thrown_str must COPY the message, not retain the caller's CsString.
//
// Retaining it made every C runtime throw that built its message in a stack `CsString` a dangling
// read at catch time. No sanitizer can see that bug: cs_throw escapes by longjmp, and ASan calls
// __asan_handle_no_return, which unpoisons the abandoned frame to avoid false positives — so a
// pointer into it reads as perfectly valid memory. The invariant has to be pinned directly.
//
// The test builds the message in a frame that is then abandoned AND overwritten, so a retained
// pointer reads clobbered bytes rather than getting lucky. Exits 0 on pass.
#include <gc.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  const char *data;
  size_t len;
} CsString;

typedef struct CsThrown CsThrown;
extern CsThrown *cs_new_error(const CsString *message);
extern CsString *cs_thrown_to_string(CsThrown *t);
extern CsString *cs_str_from(const char *data, size_t len);

static const char *EXPECTED = "Error: the original message";

// Builds the CsString header on ITS OWN stack frame and returns the CsThrown. Once this returns,
// the header is gone; only a copy can survive.
static CsThrown *make_error_from_stack_header(void) {
  CsString *body = cs_str_from("the original message", 20);
  CsString header = {body->data, body->len};  // deliberately a stack local
  return cs_new_error(&header);
}

// Overwrites the frame the header lived in, so a retained pointer sees garbage deterministically
// instead of stale-but-intact bytes.
static void clobber_frame(void) {
  volatile char junk[512];
  for (size_t i = 0; i < sizeof junk; i++) junk[i] = (char)0xAA;
}

int main(void) {
  GC_INIT();
  CsThrown *t = make_error_from_stack_header();
  clobber_frame();

  CsString *msg = cs_thrown_to_string(t);
  size_t want = strlen(EXPECTED);
  if (msg->len != want || memcmp(msg->data, EXPECTED, want) != 0) {
    printf("FAIL: cs_new_error retained the caller's CsString instead of copying it\n");
    printf("  expected %zu bytes: %s\n", want, EXPECTED);
    printf("  got      %zu bytes: %.*s\n", msg->len, (int)msg->len, msg->data);
    return 1;
  }
  return 0;
}
