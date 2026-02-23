// watch-bridge.c — File watcher for `chad watch`.
// Polls source file mtime, recompiles via system(), and re-runs via fork/exec.
// Handles SIGINT for clean child cleanup.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>

static volatile pid_t g_child_pid = 0;
static volatile int g_running = 1;

static void sigint_handler(int sig) {
    (void)sig;
    g_running = 0;
    if (g_child_pid > 0) {
        kill(g_child_pid, SIGTERM);
    }
}

// Get file modification time. Returns 0 on error.
static time_t get_mtime(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) return 0;
    return st.st_mtime;
}

// Kill the child process if running, wait for it to exit.
static void stop_child(void) {
    if (g_child_pid > 0) {
        kill(g_child_pid, SIGTERM);
        int status;
        waitpid(g_child_pid, &status, 0);
        g_child_pid = 0;
    }
}

// Fork and exec the compiled binary. Returns the child PID, or 0 on fork failure.
static pid_t start_child(const char *binary) {
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 0;
    }
    if (pid == 0) {
        // Child process — exec the binary
        execl(binary, binary, (char *)NULL);
        perror("execl");
        _exit(127);
    }
    return pid;
}

// Watches a source file for changes, recompiles and re-runs on modification.
// chad_binary: path to the chad compiler (argv[0] or resolved)
// source_file: the .ts file to watch
// output_binary: where to write the compiled output
void cs_watch_loop(const char *chad_binary, const char *source_file, const char *output_binary) {
    signal(SIGINT, sigint_handler);
    signal(SIGTERM, sigint_handler);

    // Build the compile command: "<chad_binary> build <source_file> -o <output_binary>"
    size_t cmd_len = strlen(chad_binary) + strlen(source_file) + strlen(output_binary) + 32;
    char *compile_cmd = (char *)malloc(cmd_len);
    snprintf(compile_cmd, cmd_len, "%s build %s -o %s", chad_binary, source_file, output_binary);

    time_t last_mtime = 0;

    while (g_running) {
        time_t current_mtime = get_mtime(source_file);

        // Skip if file hasn't changed (or first iteration always compiles)
        if (current_mtime == last_mtime && last_mtime != 0) {
            // Check if child exited on its own (non-blocking)
            if (g_child_pid > 0) {
                int status;
                pid_t result = waitpid(g_child_pid, &status, WNOHANG);
                if (result > 0) {
                    g_child_pid = 0;
                }
            }
            usleep(500000); // 500ms poll interval
            continue;
        }
        last_mtime = current_mtime;

        // Stop any running child before recompiling
        stop_child();

        printf("\n[watch] compiling %s...\n", source_file);
        fflush(stdout);
        int compile_status = system(compile_cmd);

        if (compile_status != 0) {
            printf("[watch] compile failed, waiting for changes...\n");
            fflush(stdout);
            // Keep polling — don't exit on compile errors
            usleep(500000);
            continue;
        }

        printf("[watch] running %s\n", output_binary);
        fflush(stdout);
        g_child_pid = start_child(output_binary);
        if (g_child_pid == 0) {
            printf("[watch] failed to start process\n");
            fflush(stdout);
        }

        usleep(500000);
    }

    // Clean shutdown
    stop_child();
    free(compile_cmd);
    printf("\n");
}
