// child-process-spawn.c — Async child process spawning via libuv.
// Bidirectional: piped stdin (parent writes) + piped stdout/stderr (parent reads)
// + streaming callbacks. Conditionally linked only when the program uses
// child_process.spawn(). Separated from child-process-bridge.c to avoid libuv
// link dependency for programs that only use sync operations.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);
extern void *GC_malloc_uncollectable(size_t);
extern void GC_free(void *);

typedef void (*cs_data_cb)(const char *data);
typedef void (*cs_exit_cb)(double exit_status);

// SpawnHandle — opaque handle returned by cs_spawn. Lifetime managed by refcount.
// Each outstanding libuv handle (proc, stdin_pipe, stdout_pipe, stderr_pipe) holds
// one ref; backing memory is freed when refcount hits 0.
// on_exit fires exactly once, gated by exit_fired, after proc+stdout+stderr close.
// Stdin close does NOT gate exit (user controls stdin lifetime).
typedef struct {
    cs_data_cb on_stdout;
    cs_data_cb on_stderr;
    cs_exit_cb on_exit;
    uv_process_t *proc;
    uv_pipe_t *stdin_pipe;
    uv_pipe_t *stdout_pipe;
    uv_pipe_t *stderr_pipe;
    double exit_status;
    int refcount;              // outstanding libuv handles referencing this ctx
    int completions_remaining; // stdout close + stderr close + proc close
    int exit_fired;            // 1 once on_exit has been called
    int stdin_closed;          // 1 once stdin_pipe has been closed
} SpawnHandle;

static void handle_unref(SpawnHandle *h) {
    h->refcount--;
    if (h->refcount <= 0) {
        if (h->proc) GC_free(h->proc);
        if (h->stdin_pipe) GC_free(h->stdin_pipe);
        if (h->stdout_pipe) GC_free(h->stdout_pipe);
        if (h->stderr_pipe) GC_free(h->stderr_pipe);
    }
}

static void spawn_maybe_fire_exit(SpawnHandle *h) {
    if (h->completions_remaining <= 0 && !h->exit_fired) {
        h->exit_fired = 1;
        if (h->on_exit) h->on_exit(h->exit_status);
    }
}

static void spawn_alloc_cb(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
    (void)handle;
    buf->base = (char *)malloc(suggested_size);
    buf->len = suggested_size;
}

// Close cb for stdout/stderr: gates exit + releases ref.
static void spawn_rpipe_close_cb(uv_handle_t *handle) {
    SpawnHandle *h = (SpawnHandle *)uv_handle_get_data(handle);
    h->completions_remaining--;
    spawn_maybe_fire_exit(h);
    handle_unref(h);
}

// Close cb for stdin: does not gate exit (user-controlled), just releases ref.
static void spawn_stdin_close_cb(uv_handle_t *handle) {
    SpawnHandle *h = (SpawnHandle *)uv_handle_get_data(handle);
    handle_unref(h);
}

static void spawn_read_cb_impl(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf, int is_stdout) {
    SpawnHandle *h = (SpawnHandle *)uv_handle_get_data((uv_handle_t *)stream);
    if (nread > 0) {
        char *data = (char *)GC_malloc_atomic((size_t)nread + 1);
        memcpy(data, buf->base, (size_t)nread);
        data[nread] = '\0';
        if (is_stdout && h->on_stdout) h->on_stdout(data);
        else if (!is_stdout && h->on_stderr) h->on_stderr(data);
    }
    if (buf->base) free(buf->base);
    if (nread < 0) {
        uv_close((uv_handle_t *)stream, spawn_rpipe_close_cb);
    }
}

static void spawn_stdout_read_cb(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
    spawn_read_cb_impl(stream, nread, buf, 1);
}

static void spawn_stderr_read_cb(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
    spawn_read_cb_impl(stream, nread, buf, 0);
}

static void spawn_proc_close_cb(uv_handle_t *handle) {
    SpawnHandle *h = (SpawnHandle *)uv_handle_get_data(handle);
    h->completions_remaining--;
    spawn_maybe_fire_exit(h);
    handle_unref(h);
}

static void spawn_exit_cb(uv_process_t *proc, int64_t exit_status, int term_signal) {
    (void)term_signal;
    SpawnHandle *h = (SpawnHandle *)uv_handle_get_data((uv_handle_t *)proc);
    h->exit_status = (double)exit_status;
    // Force-close stdin if user never called endStdin — otherwise its ref leaks.
    if (!h->stdin_closed && h->stdin_pipe) {
        h->stdin_closed = 1;
        uv_close((uv_handle_t *)h->stdin_pipe, spawn_stdin_close_cb);
    }
    uv_close((uv_handle_t *)proc, spawn_proc_close_cb);
}

// cs_spawn: spawn a child with bidirectional piped stdio + streaming callbacks.
// Returns an opaque handle usable with cs_spawn_write/end_stdin/kill; NULL on
// failure (on_exit is invoked with -1 before returning).
void *cs_spawn(const char *command, const char **args, int argc,
               cs_data_cb on_stdout, cs_data_cb on_stderr, cs_exit_cb on_exit) {
    uv_loop_t *loop = uv_default_loop();

    uv_process_t *proc = (uv_process_t *)GC_malloc_uncollectable(sizeof(uv_process_t));
    uv_pipe_t *stdin_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));
    uv_pipe_t *stdout_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));
    uv_pipe_t *stderr_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));

    uv_pipe_init(loop, stdin_pipe, 0);
    uv_pipe_init(loop, stdout_pipe, 0);
    uv_pipe_init(loop, stderr_pipe, 0);

    SpawnHandle *h = (SpawnHandle *)GC_malloc(sizeof(SpawnHandle));
    h->on_stdout = on_stdout;
    h->on_stderr = on_stderr;
    h->on_exit = on_exit;
    h->proc = proc;
    h->stdin_pipe = stdin_pipe;
    h->stdout_pipe = stdout_pipe;
    h->stderr_pipe = stderr_pipe;
    h->exit_status = -1.0;
    h->refcount = 4; // proc + stdin + stdout + stderr
    h->completions_remaining = 3; // stdout + stderr + proc (stdin excluded)
    h->exit_fired = 0;
    h->stdin_closed = 0;

    uv_handle_set_data((uv_handle_t *)proc, h);
    uv_handle_set_data((uv_handle_t *)stdin_pipe, h);
    uv_handle_set_data((uv_handle_t *)stdout_pipe, h);
    uv_handle_set_data((uv_handle_t *)stderr_pipe, h);

    char **argv;
    const char *file;
    if (argc == 0) {
        argv = (char **)malloc(4 * sizeof(char *));
        argv[0] = (char *)"/bin/sh";
        argv[1] = (char *)"-c";
        argv[2] = (char *)command;
        argv[3] = NULL;
        file = "/bin/sh";
    } else {
        argv = (char **)malloc((size_t)(argc + 2) * sizeof(char *));
        argv[0] = (char *)command;
        for (int i = 0; i < argc; i++) argv[i + 1] = (char *)args[i];
        argv[argc + 1] = NULL;
        file = command;
    }

    // stdio[0]: parent→child, READABLE from child's POV (child reads it)
    // stdio[1,2]: child→parent, WRITABLE from child's POV (child writes to them)
    uv_stdio_container_t child_stdio[3];
    child_stdio[0].flags = UV_CREATE_PIPE | UV_READABLE_PIPE;
    child_stdio[0].data.stream = (uv_stream_t *)stdin_pipe;
    child_stdio[1].flags = UV_CREATE_PIPE | UV_WRITABLE_PIPE;
    child_stdio[1].data.stream = (uv_stream_t *)stdout_pipe;
    child_stdio[2].flags = UV_CREATE_PIPE | UV_WRITABLE_PIPE;
    child_stdio[2].data.stream = (uv_stream_t *)stderr_pipe;

    uv_process_options_t opts;
    memset(&opts, 0, sizeof(opts));
    opts.exit_cb = spawn_exit_cb;
    opts.file = file;
    opts.args = argv;
    opts.stdio_count = 3;
    opts.stdio = child_stdio;

    int r = uv_spawn(loop, proc, &opts);
    free(argv);

    if (r != 0) {
        fprintf(stderr, "cs_spawn: uv_spawn failed: %s\n", uv_strerror(r));
        if (on_exit) on_exit(-1.0);
        GC_free(proc);
        GC_free(stdin_pipe);
        GC_free(stdout_pipe);
        GC_free(stderr_pipe);
        return NULL;
    }

    uv_read_start((uv_stream_t *)stdout_pipe, spawn_alloc_cb, spawn_stdout_read_cb);
    uv_read_start((uv_stream_t *)stderr_pipe, spawn_alloc_cb, spawn_stderr_read_cb);
    return h;
}

// Write-request context — holds the copied buffer until libuv has flushed.
typedef struct {
    uv_write_t req;
    char *data;
} cs_write_req_t;

static void cs_spawn_write_cb(uv_write_t *req, int status) {
    (void)status;
    cs_write_req_t *wr = (cs_write_req_t *)req;
    free(wr->data);
    free(wr);
}

// cs_spawn_write: queue a write to child's stdin. Fire-and-forget.
// No-op if handle is NULL or stdin already closed.
void cs_spawn_write(void *handle, const char *data) {
    if (!handle || !data) return;
    SpawnHandle *h = (SpawnHandle *)handle;
    if (h->stdin_closed || !h->stdin_pipe) return;

    size_t len = strlen(data);
    cs_write_req_t *wr = (cs_write_req_t *)malloc(sizeof(cs_write_req_t));
    wr->data = (char *)malloc(len);
    memcpy(wr->data, data, len);
    uv_buf_t buf = uv_buf_init(wr->data, (unsigned int)len);
    int r = uv_write(&wr->req, (uv_stream_t *)h->stdin_pipe, &buf, 1, cs_spawn_write_cb);
    if (r != 0) {
        fprintf(stderr, "cs_spawn_write: uv_write failed: %s\n", uv_strerror(r));
        free(wr->data);
        free(wr);
    }
}

// cs_spawn_end_stdin: close child's stdin (sends EOF). Idempotent.
void cs_spawn_end_stdin(void *handle) {
    if (!handle) return;
    SpawnHandle *h = (SpawnHandle *)handle;
    if (h->stdin_closed || !h->stdin_pipe) return;
    h->stdin_closed = 1;
    uv_close((uv_handle_t *)h->stdin_pipe, spawn_stdin_close_cb);
}

// cs_spawn_kill: send signal to child. signum=0 defaults to SIGTERM (15).
// No-op if process already exited.
void cs_spawn_kill(void *handle, int signum) {
    if (!handle) return;
    SpawnHandle *h = (SpawnHandle *)handle;
    if (h->exit_fired || !h->proc) return;
    if (signum == 0) signum = 15;
    uv_process_kill(h->proc, signum);
}
