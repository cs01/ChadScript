// os-bridge.c — Platform-abstracted os module helpers.
// Provides chad_os_freemem() and chad_os_uptime() that work on both
// Linux (/proc, sysconf) and macOS (sysctl, vm_statistics).

#include <stdint.h>

#ifdef __APPLE__
#include <mach/mach.h>
#include <sys/sysctl.h>
#include <time.h>
#include <unistd.h>
#else
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#endif

// Returns system free memory in bytes.
// Linux: sysconf(_SC_AVPHYS_PAGES) * page_size
// macOS: vm_statistics64 free_count * page_size
uint64_t chad_os_freemem(void) {
#ifdef __APPLE__
    vm_statistics64_data_t vm_stats;
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    kern_return_t kr = host_statistics64(mach_host_self(), HOST_VM_INFO64,
                                         (host_info64_t)&vm_stats, &count);
    if (kr != KERN_SUCCESS) return 0;
    return (uint64_t)vm_stats.free_count * (uint64_t)sysconf(_SC_PAGESIZE);
#else
    long pages = sysconf(_SC_AVPHYS_PAGES);
    long page_size = sysconf(_SC_PAGESIZE);
    if (pages < 0 || page_size < 0) return 0;
    return (uint64_t)pages * (uint64_t)page_size;
#endif
}

// Returns system uptime in seconds.
// Linux: reads /proc/uptime (first field)
// macOS: sysctl KERN_BOOTTIME, then time(NULL) - boottime
double chad_os_uptime(void) {
#ifdef __APPLE__
    struct timeval boottime;
    size_t len = sizeof(boottime);
    int mib[2] = { CTL_KERN, KERN_BOOTTIME };
    if (sysctl(mib, 2, &boottime, &len, NULL, 0) != 0) return 0.0;
    time_t now = time(NULL);
    return (double)(now - boottime.tv_sec);
#else
    FILE *f = fopen("/proc/uptime", "r");
    if (!f) return 0.0;
    char buf[64];
    size_t n = fread(buf, 1, 63, f);
    buf[n] = '\0';
    fclose(f);
    return atof(buf);
#endif
}
