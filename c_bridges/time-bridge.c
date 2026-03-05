#include <stdint.h>

#ifdef __APPLE__
#include <sys/time.h>
#else
#include <time.h>
#endif

// Returns current time in milliseconds (double for sub-ms precision).
// Uses clock_gettime(CLOCK_REALTIME) on Linux, gettimeofday on macOS.
// Avoids any struct timeval layout differences between platforms.
double cs_time_ms(void) {
#ifdef __APPLE__
    struct timeval tv;
    gettimeofday(&tv, 0);
    return (double)tv.tv_sec * 1000.0 + (double)tv.tv_usec / 1000.0;
#else
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1000000.0;
#endif
}
