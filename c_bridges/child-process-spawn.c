// child-process-spawn.c — Async child process spawning via libuv.
// Bidirectional: piped stdin (parent writes) + piped stdout/stderr (parent reads)
// + streaming callbacks. Conditionally linked only when the program uses
// child_process.spawn(). Separated from child-process-bridge.c to avoid libuv
// link dependency for programs that only use sync operations.
//
// PR2 of the C-ABI trampoline-closures series adds env-carrying callback
// variants: each of stdout/stderr/exit can be delivered either as a bare C
// function pointer (tramp_h == -1) or as a trampoline fn_ptr paired with a
// trampoline-bridge slot handle. When the handle is >= 0, the bridge recovers
// the closure env via cs_tramp_get(handle) and invokes the trampoline with env
// as its first argument. This lets ChadScript arrow-function closures work
// through the raw C callback ABI that libuv demands.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <uv.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);
extern void *GC_malloc_uncollectable(size_t);
extern void GC_free(void *);

// Trampoline-bridge API — resolves an integer handle to the env pointer
// registered at cs_tramp_alloc time. Returns NULL if handle was freed or
// is out of range.
extern void *cs_tramp_get(int32_t handle);
extern void cs_tramp_free(int32_t handle);

typedef void (*cs_data_cb)(const char *data);
typedef void (*cs_exit_cb)(double exit_status);
// Trampoline variants — first arg is the recovered env pointer. Per-shape
// trampolines (emitted as LLVM IR) read user_fn_ptr out of env and invoke it.
typedef void (*cs_data_tramp)(void *env, const char *data);
typedef void (*cs_exit_tramp)(void *env, double exit_status);

// SpawnHandle — opaque handle returned by cs_spawn. Lifetime managed by refcount.
// Each outstanding libuv handle (proc, stdin_pipe, stdout_pipe, stderr_pipe) holds
// one ref; backing memory is freed when refcount hits 0.
// on_exit fires exactly once, gated by exit_fired, after proc+stdout+stderr close.
// Stdin close does NOT gate exit (user controls stdin lifetime).
//
// Each callback position carries an optional trampoline handle. handle == -1
// means "use the bare function pointer" (back-compat path, caller passed a
// named function reference). handle >= 0 means "invoke the trampoline with
// env = cs_tramp_get(handle)". The slot is freed when that callback's
// lifecycle event fires (pipe close for stdout/stderr, after exit cb for exit).
typedef struct {
    cs_data_cb on_stdout;       // bare fn ptr; unused if tramp_h_stdout >= 0
    cs_data_cb on_stderr;
    cs_exit_cb on_exit;
    cs_data_tramp on_stdout_t;  // trampoline fn ptr; unused if tramp_h_stdout < 0
    cs_data_tramp on_stderr_t;
    cs_exit_tramp on_exit_t;
    int32_t tramp_h_stdout;
    int32_t tramp_h_stderr;
    int32_t tramp_h_exit;
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
        if (h->tramp_h_exit >= 0) {
            void *env = cs_tramp_get(h->tramp_h_exit);
            if (h->on_exit_t) h->on_exit_t(env, h->exit_status);
            cs_tramp_free(h->tramp_h_exit);
            h->tramp_h_exit = -1;
        } else if (h->on_exit) {
            h->on_exit(h->exit_status);
        }
    }
}

static void spawn_alloc_cb(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
    (void)handle;
    buf->base = (char *)malloc(suggested_size);
    buf->len = suggested_size;
}

// Close cb for stdout: gates exit, frees stdout trampoline slot, releases ref.
static void spawn_stdout_close_cb(uv_handle_t *handle) {
    SpawnHandle *h = (SpawnHandle *)uv_handle_get_data(handle);
    if (h->tramp_h_stdout >= 0) {
        cs_tramp_free(h->tramp_h_stdout);
        h->tramp_h_stdout = -1;
    }
    h->completions_remaining--;
    spawn_maybe_fire_exit(h);
    handle_unref(h);
}

// Close cb for stderr: mirror of stdout close.
static void spawn_stderr_close_cb(uv_handle_t *handle) {
    SpawnHandle *h = (SpawnHandle *)uv_handle_get_data(handle);
    if (h->tramp_h_stderr >= 0) {
        cs_tramp_free(h->tramp_h_stderr);
        h->tramp_h_stderr = -1;
    }
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
        if (is_stdout) {
            if (h->tramp_h_stdout >= 0) {
                void *env = cs_tramp_get(h->tramp_h_stdout);
                if (h->on_stdout_t) h->on_stdout_t(env, data);
            } else if (h->on_stdout) {
                h->on_stdout(data);
            }
        } else {
            if (h->tramp_h_stderr >= 0) {
                void *env = cs_tramp_get(h->tramp_h_stderr);
                if (h->on_stderr_t) h->on_stderr_t(env, data);
            } else if (h->on_stderr) {
                h->on_stderr(data);
            }
        }
    }
    if (buf->base) free(buf->base);
    if (nread < 0) {
        uv_close((uv_handle_t *)stream, is_stdout ? spawn_stdout_close_cb : spawn_stderr_close_cb);
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

// cs_spawn_v2: widened signature — each callback is paired with a trampoline
// handle. handle == -1 means the corresponding fn_ptr is a bare C function
// (back-compat); handle >= 0 means fn_ptr is a trampoline and env is
// recovered via cs_tramp_get(handle) at dispatch time.
//
// cb_stdout / cb_stderr / cb_exit are interpreted as cs_data_cb / cs_exit_cb
// when the matching handle is -1, and as cs_data_tramp / cs_exit_tramp
// when >= 0. Caller must type them consistently — they're stored as generic
// function pointers in the struct.
void *cs_spawn_v2(const char *command, const char **args, int argc,
                  void (*cb_stdout)(), int32_t h_stdout,
                  void (*cb_stderr)(), int32_t h_stderr,
                  void (*cb_exit)(),   int32_t h_exit) {
    uv_loop_t *loop = uv_default_loop();

    uv_process_t *proc = (uv_process_t *)GC_malloc_uncollectable(sizeof(uv_process_t));
    uv_pipe_t *stdin_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));
    uv_pipe_t *stdout_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));
    uv_pipe_t *stderr_pipe = (uv_pipe_t *)GC_malloc_uncollectable(sizeof(uv_pipe_t));

    uv_pipe_init(loop, stdin_pipe, 0);
    uv_pipe_init(loop, stdout_pipe, 0);
    uv_pipe_init(loop, stderr_pipe, 0);

    SpawnHandle *h = (SpawnHandle *)GC_malloc(sizeof(SpawnHandle));
    // Bare vs trampoline: store into the matching slot based on handle.
    if (h_stdout >= 0) { h->on_stdout_t = (cs_data_tramp)cb_stdout; h->on_stdout = NULL; }
    else               { h->on_stdout   = (cs_data_cb)cb_stdout;    h->on_stdout_t = NULL; }
    if (h_stderr >= 0) { h->on_stderr_t = (cs_data_tramp)cb_stderr; h->on_stderr = NULL; }
    else               { h->on_stderr   = (cs_data_cb)cb_stderr;    h->on_stderr_t = NULL; }
    if (h_exit   >= 0) { h->on_exit_t   = (cs_exit_tramp)cb_exit;   h->on_exit   = NULL; }
    else               { h->on_exit     = (cs_exit_cb)cb_exit;      h->on_exit_t  = NULL; }
    h->tramp_h_stdout = h_stdout;
    h->tramp_h_stderr = h_stderr;
    h->tramp_h_exit   = h_exit;
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
        // Fire exit cb synchronously with -1, draining any trampoline slots.
        if (h->tramp_h_exit >= 0) {
            void *env = cs_tramp_get(h->tramp_h_exit);
            if (h->on_exit_t) h->on_exit_t(env, -1.0);
            cs_tramp_free(h->tramp_h_exit);
            h->tramp_h_exit = -1;
        } else if (h->on_exit) {
            h->on_exit(-1.0);
        }
        // stdout/stderr trampoline slots will never fire — free them now.
        if (h->tramp_h_stdout >= 0) { cs_tramp_free(h->tramp_h_stdout); h->tramp_h_stdout = -1; }
        if (h->tramp_h_stderr >= 0) { cs_tramp_free(h->tramp_h_stderr); h->tramp_h_stderr = -1; }
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

// cs_spawn: legacy entry point — all three callbacks are bare fn ptrs.
// Kept as a thin shim over cs_spawn_v2 so existing callers (programs emitted
// by older codegen, or users passing named function references) don't need
// to change. Codegen now emits cs_spawn_v2 directly.
void *cs_spawn(const char *command, const char **args, int argc,
               cs_data_cb on_stdout, cs_data_cb on_stderr, cs_exit_cb on_exit) {
    return cs_spawn_v2(command, args, argc,
                       (void (*)())on_stdout, -1,
                       (void (*)())on_stderr, -1,
                       (void (*)())on_exit,   -1);
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
