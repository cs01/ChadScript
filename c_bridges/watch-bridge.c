// watch-bridge.c — File watcher for `chad watch`.
// Uses inotify on Linux for event-based file change detection (no polling).
// Falls back to stat() polling on macOS/other platforms.
// Recompiles via system(), re-runs via fork/exec.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>

#ifdef __linux__
#include <sys/inotify.h>
#include <poll.h>
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

// Reap child if it exited on its own (non-blocking).
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

// Watches a source file for changes, recompiles and re-runs on modification.
void cs_watch_loop(const char *chad_binary, const char *source_file, const char *output_binary) {
    signal(SIGINT, sigint_handler);
    signal(SIGTERM, sigint_handler);

    size_t cmd_len = strlen(chad_binary) + strlen(source_file) + strlen(output_binary) + 32;
    char *compile_cmd = (char *)malloc(cmd_len);
    snprintf(compile_cmd, cmd_len, "%s build %s -o %s", chad_binary, source_file, output_binary);

    // Initial compile + run
    compile_and_run(compile_cmd, source_file, output_binary);

#ifdef __linux__
    // Event-based watching via inotify — blocks until the file changes
    int ifd = inotify_init();
    if (ifd < 0) { perror("inotify_init"); goto fallback; }

    int wd = inotify_add_watch(ifd, source_file, IN_MODIFY | IN_CLOSE_WRITE);
    if (wd < 0) { perror("inotify_add_watch"); close(ifd); goto fallback; }

    char buf[4096];
    struct pollfd pfd = { .fd = ifd, .events = POLLIN };

    while (g_running) {
        // poll with 1s timeout so we can check g_running and reap children
        int ret = poll(&pfd, 1, 1000);
        reap_child();
        if (ret < 0) break;   // error or signal
        if (ret == 0) continue; // timeout, just reap and loop

        // Drain all inotify events
        ssize_t n = read(ifd, buf, sizeof(buf));
        if (n <= 0) continue;

        // Small debounce — editors often write multiple events (temp file, rename, etc.)
        usleep(50000); // 50ms

        // Drain any additional events that arrived during debounce
        struct pollfd drain_pfd = { .fd = ifd, .events = POLLIN };
        while (poll(&drain_pfd, 1, 0) > 0) {
            read(ifd, buf, sizeof(buf));
        }

        // Re-add the watch — some editors (vim) delete+recreate the file
        inotify_rm_watch(ifd, wd);
        wd = inotify_add_watch(ifd, source_file, IN_MODIFY | IN_CLOSE_WRITE);
        if (wd < 0) {
            // File might be briefly gone during save, retry
            usleep(100000);
            wd = inotify_add_watch(ifd, source_file, IN_MODIFY | IN_CLOSE_WRITE);
            if (wd < 0) { perror("inotify_add_watch"); break; }
        }

        compile_and_run(compile_cmd, source_file, output_binary);
    }

    close(ifd);
    goto done;

fallback:
#endif
    // Polling fallback for macOS / inotify failure
    {
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

#ifdef __linux__
done:
#endif
    stop_child();
    free(compile_cmd);
    printf("\n");
}
