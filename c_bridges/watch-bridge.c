// watch-bridge.c — File watcher for `chad watch`.
// Uses inotify on Linux and kqueue on macOS for event-based file change detection.
// Recompiles via system(), re-runs via fork/exec.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <poll.h>

#ifdef __linux__
#include <sys/inotify.h>
#elif defined(__APPLE__)
#include <sys/event.h>
#endif

static volatile pid_t g_child_pid = 0;
static volatile int g_running = 1;

static void sigint_handler(int sig) {
    (void)sig;
    g_running = 0;
    if (g_child_pid > 0) {
        kill(g_child_pid, SIGTERM);
    }
}

static void stop_child(void) {
    if (g_child_pid > 0) {
        kill(g_child_pid, SIGTERM);
        int status;
        waitpid(g_child_pid, &status, 0);
        g_child_pid = 0;
    }
}

static void reap_child(void) {
    if (g_child_pid > 0) {
        int status;
        pid_t result = waitpid(g_child_pid, &status, WNOHANG);
        if (result > 0) g_child_pid = 0;
    }
}

static pid_t start_child(const char *binary) {
    pid_t pid = fork();
    if (pid < 0) { perror("fork"); return 0; }
    if (pid == 0) {
        execl(binary, binary, (char *)NULL);
        perror("execl");
        _exit(127);
    }
    return pid;
}

static void compile_and_run(const char *compile_cmd, const char *source_file, const char *output_binary) {
    stop_child();
    printf("\n[watch] compiling %s...\n", source_file);
    fflush(stdout);

    int rc = system(compile_cmd);
    if (rc != 0) {
        printf("[watch] compile failed, waiting for changes...\n");
        fflush(stdout);
        return;
    }

    printf("[watch] running %s\n", output_binary);
    fflush(stdout);
    g_child_pid = start_child(output_binary);
    if (g_child_pid == 0) {
        printf("[watch] failed to start process\n");
        fflush(stdout);
    }
}

#ifdef __linux__
// inotify-based watcher. Returns 0 on success, -1 to fall back to polling.
static int watch_inotify(const char *compile_cmd, const char *source_file, const char *output_binary) {
    int ifd = inotify_init();
    if (ifd < 0) return -1;

    int wd = inotify_add_watch(ifd, source_file, IN_MODIFY | IN_CLOSE_WRITE);
    if (wd < 0) { close(ifd); return -1; }

    char buf[4096];
    struct pollfd pfd = { .fd = ifd, .events = POLLIN };

    while (g_running) {
        int ret = poll(&pfd, 1, 1000);
        reap_child();
        if (ret < 0) break;
        if (ret == 0) continue;

        ssize_t n = read(ifd, buf, sizeof(buf));
        if (n <= 0) continue;

        // 50ms debounce — editors often fire multiple events per save
        usleep(50000);
        struct pollfd drain_pfd = { .fd = ifd, .events = POLLIN };
        while (poll(&drain_pfd, 1, 0) > 0) {
            read(ifd, buf, sizeof(buf));
        }

        // Re-add watch — vim and other editors delete+recreate the file
        inotify_rm_watch(ifd, wd);
        wd = inotify_add_watch(ifd, source_file, IN_MODIFY | IN_CLOSE_WRITE);
        if (wd < 0) {
            usleep(100000); // file briefly gone during save
            wd = inotify_add_watch(ifd, source_file, IN_MODIFY | IN_CLOSE_WRITE);
            if (wd < 0) break;
        }

        compile_and_run(compile_cmd, source_file, output_binary);
    }

    close(ifd);
    return 0;
}
#endif

#ifdef __APPLE__
// kqueue-based watcher. Returns 0 on success, -1 to fall back to polling.
static int watch_kqueue(const char *compile_cmd, const char *source_file, const char *output_binary) {
    int kq = kqueue();
    if (kq < 0) return -1;

    int fd = open(source_file, O_RDONLY);
    if (fd < 0) { close(kq); return -1; }

    struct kevent change;
    EV_SET(&change, fd, EVFILT_VNODE, EV_ADD | EV_CLEAR,
           NOTE_WRITE | NOTE_RENAME | NOTE_DELETE, 0, NULL);
    if (kevent(kq, &change, 1, NULL, 0, NULL) < 0) {
        close(fd); close(kq); return -1;
    }

    struct kevent event;
    struct timespec timeout = { .tv_sec = 1, .tv_nsec = 0 };

    while (g_running) {
        int ret = kevent(kq, NULL, 0, &event, 1, &timeout);
        reap_child();
        if (ret < 0) break;
        if (ret == 0) continue;

        // 50ms debounce
        usleep(50000);

        // If file was deleted/renamed (vim save), re-open and re-register
        if (event.fflags & (NOTE_DELETE | NOTE_RENAME)) {
            close(fd);
            usleep(50000); // wait for editor to finish writing
            fd = open(source_file, O_RDONLY);
            if (fd < 0) break;
            EV_SET(&change, fd, EVFILT_VNODE, EV_ADD | EV_CLEAR,
                   NOTE_WRITE | NOTE_RENAME | NOTE_DELETE, 0, NULL);
            if (kevent(kq, &change, 1, NULL, 0, NULL) < 0) break;
        }

        compile_and_run(compile_cmd, source_file, output_binary);
    }

    close(fd);
    close(kq);
    return 0;
}
#endif

// Polling fallback — used if inotify/kqueue fails or on unsupported platforms.
static void watch_poll(const char *compile_cmd, const char *source_file, const char *output_binary) {
    struct stat st;
    time_t last_mtime = 0;
    if (stat(source_file, &st) == 0) last_mtime = st.st_mtime;

    while (g_running) {
        reap_child();
        usleep(500000);
        if (stat(source_file, &st) != 0) continue;
        if (st.st_mtime == last_mtime) continue;
        last_mtime = st.st_mtime;
        compile_and_run(compile_cmd, source_file, output_binary);
    }
}

// Watches a source file for changes, recompiles and re-runs on modification.
void cs_watch_loop(const char *chad_binary, const char *source_file, const char *output_binary) {
    signal(SIGINT, sigint_handler);
    signal(SIGTERM, sigint_handler);

    size_t cmd_len = strlen(chad_binary) + strlen(source_file) + strlen(output_binary) + 32;
    char *compile_cmd = (char *)malloc(cmd_len);
    snprintf(compile_cmd, cmd_len, "%s build %s -o %s", chad_binary, source_file, output_binary);

    // Initial compile + run
    compile_and_run(compile_cmd, source_file, output_binary);

    // Use platform-native event API, fall back to polling
    int used_native = 0;
#ifdef __linux__
    used_native = (watch_inotify(compile_cmd, source_file, output_binary) == 0);
#elif defined(__APPLE__)
    used_native = (watch_kqueue(compile_cmd, source_file, output_binary) == 0);
#endif
    if (!used_native) {
        watch_poll(compile_cmd, source_file, output_binary);
    }

    stop_child();
    free(compile_cmd);
    printf("\n");
}
