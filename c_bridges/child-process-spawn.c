// child-process-spawn.c — Async child process spawning via libuv.
// Uses uv_spawn with piped stdout/stderr and streaming callbacks.
// Conditionally linked only when the program uses child_process.spawn().
// Separated from child-process-bridge.c to avoid libuv link dependency for
// programs that only use sync operations (or don't use child_process at all).

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);
extern void *GC_malloc_uncollectable(size_t);

// Callback typedefs matching ChadScript function signatures
typedef void (*cs_data_cb)(const char *data);
typedef void (*cs_exit_cb)(double exit_status);

// Context for an async spawn — holds callbacks, exit status, and completion tracking.
// The user's onExit fires only when ALL conditions are met:
//   1. Both pipes have closed (all stdout/stderr data delivered)
//   2. The process exit callback has fired (exit status known)
// Either event can happen first, so we track both with a countdown.
typedef struct {
    cs_data_cb on_stdout;
    cs_data_cb on_stderr;
    cs_exit_cb on_exit;
    double exit_status;
    int completions_remaining; // starts at 3 (stdout pipe + stderr pipe + exit cb)
} SpawnContext;

// uv alloc callback — allocate temp read buffer
static void spawn_alloc_cb(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
    (void)handle;
    buf->base = (char *)malloc(suggested_size);
    buf->len = suggested_size;
}

// Helper: check if all completions are done (pipes closed + exit received), fire onExit
static void spawn_maybe_fire_exit(SpawnContext *ctx) {
    if (ctx->completions_remaining <= 0 && ctx->on_exit) {
        ctx->on_exit(ctx->exit_status);
    }
}

// Called when a pipe handle is closed
static void spawn_pipe_close_cb(uv_handle_t *handle) {
    SpawnContext *ctx = (SpawnContext *)uv_handle_get_data(handle);
    ctx->completions_remaining--;
    spawn_maybe_fire_exit(ctx);
}

// Helper: copy read data to GC string and invoke user callback
static void spawn_read_cb_impl(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf, int is_stdout) {
    SpawnContext *ctx = (SpawnContext *)uv_handle_get_data((uv_handle_t *)stream);
    if (nread > 0) {
        char *data = (char *)GC_malloc_atomic((size_t)nread + 1);
        memcpy(data, buf->base, (size_t)nread);
        data[nread] = '\0';
        if (is_stdout && ctx->on_stdout) {
            ctx->on_stdout(data);
        } else if (!is_stdout && ctx->on_stderr) {
            ctx->on_stderr(data);
        }
    }
    if (buf->base) free(buf->base);
    if (nread < 0) {
        // EOF or error — close this pipe (triggers spawn_pipe_close_cb)
        uv_close((uv_handle_t *)stream, spawn_pipe_close_cb);
    }
}

static void spawn_stdout_read_cb(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
    spawn_read_cb_impl(stream, nread, buf, 1);
}

static void spawn_stderr_read_cb(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
    spawn_read_cb_impl(stream, nread, buf, 0);
}

// Process exit callback — store exit status, close process handle, check if all done.
static void spawn_proc_close_cb(uv_handle_t *handle) {
    SpawnContext *ctx = (SpawnContext *)uv_handle_get_data(handle);
    ctx->completions_remaining--;
    spawn_maybe_fire_exit(ctx);
}

static void spawn_exit_cb(uv_process_t *proc, int64_t exit_status, int term_signal) {
    (void)term_signal;
    SpawnContext *ctx = (SpawnContext *)uv_handle_get_data((uv_handle_t *)proc);
    ctx->exit_status = (double)exit_status;
    // Close process handle; its close callback decrements completions_remaining
    uv_close((uv_handle_t *)proc, spawn_proc_close_cb);
}

// cs_spawn: spawn a child process with piped stdout/stderr and streaming callbacks.
// When argc == 0: shell mode (runs through /bin/sh -c command)
// When argc > 0: direct exec mode with args array
// Callbacks are invoked on the main event loop thread as data arrives.
void cs_spawn(const char *command, const char **args, int argc,
              cs_data_cb on_stdout, cs_data_cb on_stderr, cs_exit_cb on_exit) {
    uv_loop_t *loop = uv_default_loop();

    // Allocate handles with GC_malloc_uncollectable — libuv stores internal pointers
    // in these structs that the GC can't trace, so they must not be collected
    uv_process_t *proc = (uv_process_t *)GC_malloc_uncollectable(sizeof(uv_process_t));
    uv_pipe_t *stdout_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));
    uv_pipe_t *stderr_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));

    uv_pipe_init(loop, stdout_pipe, 0);
    uv_pipe_init(loop, stderr_pipe, 0);

    SpawnContext *ctx = (SpawnContext *)GC_malloc(sizeof(SpawnContext));
    ctx->on_stdout = on_stdout;
    ctx->on_stderr = on_stderr;
    ctx->on_exit = on_exit;
    ctx->exit_status = -1.0;
    ctx->completions_remaining = 3; // stdout pipe close + stderr pipe close + exit callback

    uv_handle_set_data((uv_handle_t *)proc, ctx);
    uv_handle_set_data((uv_handle_t *)stdout_pipe, ctx);
    uv_handle_set_data((uv_handle_t *)stderr_pipe, ctx);

    // Build args array
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
        for (int i = 0; i < argc; i++) {
            argv[i + 1] = (char *)args[i];
        }
        argv[argc + 1] = NULL;
        file = command;
    }

    // Configure stdio: stdin=ignore, stdout=pipe, stderr=pipe
    // UV_WRITABLE_PIPE = child can write to this fd (parent reads from it)
    uv_stdio_container_t child_stdio[3];
    child_stdio[0].flags = UV_IGNORE;
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
        return;
    }

    uv_read_start((uv_stream_t *)stdout_pipe, spawn_alloc_cb, spawn_stdout_read_cb);
    uv_read_start((uv_stream_t *)stderr_pipe, spawn_alloc_cb, spawn_stderr_read_cb);
}
