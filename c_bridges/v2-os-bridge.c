#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <sys/utsname.h>
#include <pwd.h>

char *cs2_os_hostname(void) {
    char buf[256];
    gethostname(buf, sizeof(buf));
    char *result = (char *)malloc(strlen(buf) + 1);
    strcpy(result, buf);
    return result;
}

char *cs2_os_homedir(void) {
    const char *home = getenv("HOME");
    if (!home) {
        struct passwd *pw = getpwuid(getuid());
        home = pw ? pw->pw_dir : "/tmp";
    }
    char *result = (char *)malloc(strlen(home) + 1);
    strcpy(result, home);
    return result;
}

char *cs2_os_tmpdir(void) {
    const char *tmp = getenv("TMPDIR");
    if (!tmp) tmp = "/tmp";
    char *result = (char *)malloc(strlen(tmp) + 1);
    strcpy(result, tmp);
    return result;
}

char *cs2_os_platform(void) {
#ifdef __APPLE__
    return "darwin";
#elif defined(__linux__)
    return "linux";
#else
    return "unknown";
#endif
}

char *cs2_os_arch(void) {
#ifdef __aarch64__
    return "arm64";
#elif defined(__x86_64__)
    return "x64";
#else
    return "unknown";
#endif
}

char *cs2_os_type(void) {
    struct utsname u;
    uname(&u);
    char *result = (char *)malloc(strlen(u.sysname) + 1);
    strcpy(result, u.sysname);
    return result;
}

double cs2_os_uptime(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

char *cs2_os_eol(void) {
    return "\n";
}
