// child-process-bridge.c — C bridge for child_process sync operations.
// cs_execSync (popen-based) and cs_spawnSync (fork/execvp with pipes).
// Always linked: the native compiler itself uses cs_execSync for running clang/llc.
// Async spawn lives in child-process-spawn.c (linked only when libuv is available).

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);

// SpawnSyncResult layout must match %SpawnSyncResult in LLVM IR:
//   { i8* stdout, i8* stderr, double status }
typedef struct {
    char *out;
    char *err;
    double status;
} SpawnSyncResult;

// Read all data from fd into a dynamically-grown GC buffer. Returns GC string.
static char *read_fd_to_gc_string(int fd) {
    size_t capacity = 4096;
    size_t len = 0;
    // Use malloc for the temp read buffer, then copy to GC at the end
    char *buf = (char *)malloc(capacity);
    if (!buf) return (char *)GC_malloc_atomic(1);

    for (;;) {
        ssize_t n = read(fd, buf + len, capacity - len);
        if (n <= 0) break;
        len += (size_t)n;
        if (len >= capacity) {
            capacity *= 2;
            char *newbuf = (char *)realloc(buf, capacity);
            if (!newbuf) break;
            buf = newbuf;
        }
    }

    // Copy into GC-managed memory
    char *result = (char *)GC_malloc_atomic(len + 1);
    memcpy(result, buf, len);
    result[len] = '\0';
    free(buf);
    return result;
}

// Strip trailing newline from string (in-place). Matches Node.js execSync behavior.
static void strip_trailing_newline(char *s) {
    size_t len = strlen(s);
    while (len > 0 && (s[len - 1] == '\n' || s[len - 1] == '\r')) {
        s[--len] = '\0';
    }
}

// cs_execSync: run command via popen, return stdout as GC string (trailing newline stripped).
// Crashes (exit 1) on non-zero exit code, matching Node.js execSync behavior.
char *cs_execSync(const char *command) {
    FILE *fp = popen(command, "r");
    if (!fp) {
        fprintf(stderr, "execSync: failed to run command: %s\n", command);
        exit(1);
    }

    size_t capacity = 4096;
    size_t len = 0;
    char *buf = (char *)malloc(capacity);
    if (!buf) {
        pclose(fp);
        fprintf(stderr, "execSync: out of memory\n");
        exit(1);
    }

    for (;;) {
        size_t n = fread(buf + len, 1, capacity - len, fp);
        if (n == 0) break;
        len += n;
        if (len >= capacity) {
            capacity *= 2;
            char *newbuf = (char *)realloc(buf, capacity);
            if (!newbuf) break;
            buf = newbuf;
        }
    }

    int status = pclose(fp);
    int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 1;

    if (exit_code != 0) {
        fprintf(stderr, "execSync: command failed with exit code %d: %s\n", exit_code, command);
        free(buf);
        exit(1);
    }

    // Copy to GC memory and strip trailing newline
    char *result = (char *)GC_malloc_atomic(len + 1);
    memcpy(result, buf, len);
    result[len] = '\0';
    free(buf);
    strip_trailing_newline(result);
    return result;
}

// cs_spawnSync: fork/exec with separate stdout/stderr pipes.
// When argc == 0, runs command through /bin/sh -c (shell mode).
// When argc > 0, uses execvp directly (no shell).
// Returns GC-allocated SpawnSyncResult*.
void *cs_spawnSync(const char *command, const char **args, int argc) {
    int stdout_pipe[2];
    int stderr_pipe[2];

    if (pipe(stdout_pipe) != 0 || pipe(stderr_pipe) != 0) {
        fprintf(stderr, "spawnSync: pipe() failed\n");
        exit(1);
    }

    pid_t pid = fork();
    if (pid < 0) {
        fprintf(stderr, "spawnSync: fork() failed\n");
        exit(1);
    }

    if (pid == 0) {
        // Child: redirect stdout/stderr to pipes, close read ends
        close(stdout_pipe[0]);
        close(stderr_pipe[0]);
        dup2(stdout_pipe[1], STDOUT_FILENO);
        dup2(stderr_pipe[1], STDERR_FILENO);
        close(stdout_pipe[1]);
        close(stderr_pipe[1]);

        if (argc == 0) {
            // Shell mode: /bin/sh -c "command"
            execlp("/bin/sh", "sh", "-c", command, (char *)NULL);
        } else {
            // Direct exec mode: build argv array [command, args..., NULL]
            char **argv = (char **)malloc((size_t)(argc + 2) * sizeof(char *));
            argv[0] = (char *)command;
            for (int i = 0; i < argc; i++) {
                argv[i + 1] = (char *)args[i];
            }
            argv[argc + 1] = NULL;
            execvp(command, argv);
        }
        // If exec fails, exit with 127 (command not found)
        _exit(127);
    }

    // Parent: close write ends, read from both pipes
    close(stdout_pipe[1]);
    close(stderr_pipe[1]);

    char *out_str = read_fd_to_gc_string(stdout_pipe[0]);
    char *err_str = read_fd_to_gc_string(stderr_pipe[0]);
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);

    int status;
    waitpid(pid, &status, 0);
    int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 1;

    SpawnSyncResult *result = (SpawnSyncResult *)GC_malloc(sizeof(SpawnSyncResult));
    result->out = out_str;
    result->err = err_str;
    result->status = (double)exit_code;
    return result;
}
