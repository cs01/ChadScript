// Clock access. `Date.now()` is milliseconds since the epoch as a JS number (f64), which is what
// the whole subset uses for numbers — no int64 crosses the ABI.

#include <stdint.h>

#ifdef __APPLE__
#include <sys/time.h>
#else
#include <time.h>
#endif

// Milliseconds since the Unix epoch. Node's Date.now() truncates to whole milliseconds, so this
// does too — returning sub-millisecond precision would be a visible divergence in any program
// that prints the value.
double cs_date_now(void) {
#ifdef __APPLE__
  struct timeval tv;
  gettimeofday(&tv, 0);
  double ms = (double)tv.tv_sec * 1000.0 + (double)tv.tv_usec / 1000.0;
#else
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  double ms = (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1000000.0;
#endif
  // Truncate toward zero; the epoch value is positive, so this is a floor.
  return (double)(int64_t)ms;
}
