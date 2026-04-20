// net-bridge.c — plain-TCP client sockets via libuv.
//
// Exposes a synchronous TCP client API to ChadScript user code. The bridge
// runs libuv's default loop in blocking (UV_RUN_ONCE) and non-blocking
// (UV_RUN_NOWAIT) modes as needed to drive connect/read/write/close. All
// async events are buffered inside per-socket state; TS-side listeners are
// invoked by ChadScript when it calls cs_net_poll_* to drain the event queue.
//
// No trampoline / function-pointer callbacks cross the FFI boundary — the
// bridge owns all uv_* callbacks, and TS polls for completed work. This
// keeps the FFI surface a flat set of C functions with scalar/string args,
// avoids entanglement with ChadScript closure codegen, and is enough for
// request/response protocols (Postgres wire, Redis RESP, plain HTTP).
//
// Event model: the bridge tracks four event kinds per socket — connect,
// data, error, close — and queues them on a per-socket FIFO linked list.
// TS drains them via cs_net_poll_event_kind + cs_net_poll_event_data +
// cs_net_poll_event_consume. TS dispatches to on(event, cb) listeners in
// user code.

#include <uv.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <netinet/in.h>
#include <arpa/inet.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);

#define NET_EVENT_CONNECT 1
#define NET_EVENT_DATA    2
#define NET_EVENT_ERROR   3
#define NET_EVENT_CLOSE   4

typedef struct NetEvent {
    int kind;
    char *data;         // payload (err message for error, bytes for data). NULL for connect/close.
    size_t data_len;    // byte count for data events
    struct NetEvent *next;
} NetEvent;

typedef struct {
    uv_tcp_t handle;
    uv_connect_t connect_req;
    int connected;        // 1 after successful connect, 0 before
    int connect_failed;   // 1 if connect errored
    int closed;           // 1 after uv_close completed
    int close_requested;  // 1 if end/destroy already initiated
    int reading;          // 1 if uv_read_start is active

    // Inbound byte buffer (growing). Separate from event queue so the caller
    // can use a pull-style API (cs_net_rx_drain) without needing listeners.
    char *rx_buf;
    size_t rx_len;
    size_t rx_cap;

    // Event queue (FIFO linked list) for push-style listener dispatch.
    NetEvent *ev_head;
    NetEvent *ev_tail;

    // Last error message, GC-allocated.
    char *last_error;
} NetSocket;

static void net_enqueue(NetSocket *s, int kind, const char *data, size_t data_len) {
    NetEvent *ev = (NetEvent *)GC_malloc(sizeof(NetEvent));
    ev->kind = kind;
    ev->data = NULL;
    ev->data_len = 0;
    ev->next = NULL;
    if (data && data_len > 0) {
        char *copy = (char *)GC_malloc_atomic(data_len + 1);
        memcpy(copy, data, data_len);
        copy[data_len] = '\0';
        ev->data = copy;
        ev->data_len = data_len;
    }
    if (s->ev_tail) {
        s->ev_tail->next = ev;
        s->ev_tail = ev;
    } else {
        s->ev_head = ev;
        s->ev_tail = ev;
    }
}

static void net_alloc_cb(uv_handle_t *h, size_t suggested, uv_buf_t *buf) {
    (void)h;
    buf->base = (char *)malloc(suggested);
    buf->len = suggested;
}

static void net_close_cb(uv_handle_t *h) {
    NetSocket *s = (NetSocket *)uv_handle_get_data(h);
    if (!s) return;
    s->closed = 1;
    net_enqueue(s, NET_EVENT_CLOSE, NULL, 0);
}

static void net_read_cb(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
    NetSocket *s = (NetSocket *)uv_handle_get_data((uv_handle_t *)stream);
    if (!s) {
        if (buf->base) free(buf->base);
        return;
    }
    if (nread > 0) {
        size_t needed = s->rx_len + (size_t)nread;
        if (needed > s->rx_cap) {
            size_t newcap = s->rx_cap > 0 ? s->rx_cap : 4096;
            while (newcap < needed) newcap *= 2;
            char *nb = (char *)malloc(newcap);
            if (s->rx_len > 0) memcpy(nb, s->rx_buf, s->rx_len);
            free(s->rx_buf);
            s->rx_buf = nb;
            s->rx_cap = newcap;
        }
        memcpy(s->rx_buf + s->rx_len, buf->base, (size_t)nread);
        s->rx_len += (size_t)nread;
        net_enqueue(s, NET_EVENT_DATA, buf->base, (size_t)nread);
    } else if (nread < 0) {
        if (nread == UV_EOF) {
            if (!s->close_requested && !s->closed) {
                s->close_requested = 1;
                uv_read_stop(stream);
                uv_close((uv_handle_t *)&s->handle, net_close_cb);
            }
        } else {
            const char *msg = uv_strerror((int)nread);
            net_enqueue(s, NET_EVENT_ERROR, msg, strlen(msg));
            if (!s->close_requested && !s->closed) {
                s->close_requested = 1;
                uv_read_stop(stream);
                uv_close((uv_handle_t *)&s->handle, net_close_cb);
            }
        }
    }
    if (buf->base) free(buf->base);
}

static void net_connect_cb(uv_connect_t *req, int status) {
    NetSocket *s = (NetSocket *)req->data;
    if (status < 0) {
        const char *msg = uv_strerror(status);
        size_t n = strlen(msg);
        char *copy = (char *)GC_malloc_atomic(n + 1);
        memcpy(copy, msg, n + 1);
        s->last_error = copy;
        s->connect_failed = 1;
        net_enqueue(s, NET_EVENT_ERROR, msg, n);
        return;
    }
    s->connected = 1;
    net_enqueue(s, NET_EVENT_CONNECT, NULL, 0);
    uv_read_start((uv_stream_t *)&s->handle, net_alloc_cb, net_read_cb);
    s->reading = 1;
}

// Resolve host:port via libuv's sync getaddrinfo. Fast-paths dotted-quad
// literals to avoid the DNS round-trip. Returns 0 on success; libuv errno
// (negative) on failure.
static int net_resolve(const char *host, int port, struct sockaddr_in *out) {
    if (uv_ip4_addr(host, port, out) == 0) return 0;

    uv_getaddrinfo_t resolver;
    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    int r = uv_getaddrinfo(uv_default_loop(), &resolver, NULL, host, NULL, &hints);
    if (r < 0) return r;
    if (!resolver.addrinfo) return -1;

    struct sockaddr_in *addr = (struct sockaddr_in *)resolver.addrinfo->ai_addr;
    out->sin_family = AF_INET;
    out->sin_addr = addr->sin_addr;
    out->sin_port = htons((uint16_t)port);
    uv_freeaddrinfo(resolver.addrinfo);
    return 0;
}

// ---- write request plumbing ----

typedef struct {
    uv_write_t req;
    char *owned;   // malloc'd copy of caller bytes; freed in net_write_done
} net_write_req_t;

static void net_write_done(uv_write_t *req, int status) {
    (void)status;
    net_write_req_t *wr = (net_write_req_t *)req;
    free(wr->owned);
    free(wr);
}

// ---- public API ----

// Open a TCP connection to host:port. Blocks until the handshake succeeds
// or fails (drives uv_run in UV_RUN_ONCE mode until a terminal event).
// Always returns a NetSocket* — on failure the returned socket has
// connect_failed=1 and closed=1 set, so cs_net_is_open/poll/etc behave
// like a dead socket. Returning a valid pointer on failure (instead of
// NULL) matters because the ChadScript FFI converts NULL char* returns
// into empty-string pointers, which defeat `if (!s)` guards in every
// other function in this bridge. last_error holds the uv_strerror msg.
void *cs_net_connect(const char *host, double port) {
    NetSocket *s = (NetSocket *)GC_malloc(sizeof(NetSocket));
    memset(s, 0, sizeof(*s));

    if (!host) {
        s->connect_failed = 1;
        s->closed = 1;
        s->last_error = (char *)"invalid host";
        return (void *)s;
    }
    int port_i = (int)port;

    uv_loop_t *loop = uv_default_loop();
    uv_tcp_init(loop, &s->handle);
    uv_tcp_nodelay(&s->handle, 1);
    uv_handle_set_data((uv_handle_t *)&s->handle, s);
    s->connect_req.data = s;

    struct sockaddr_in addr;
    int rr = net_resolve(host, port_i, &addr);
    if (rr < 0) {
        const char *msg = uv_strerror(rr);
        size_t n = strlen(msg);
        char *copy = (char *)GC_malloc_atomic(n + 1);
        memcpy(copy, msg, n + 1);
        s->last_error = copy;
        s->connect_failed = 1;
        uv_close((uv_handle_t *)&s->handle, net_close_cb);
        while (!s->closed) {
            if (uv_run(loop, UV_RUN_ONCE) == 0) break;
        }
        return (void *)s;
    }

    int cr = uv_tcp_connect(&s->connect_req, &s->handle,
                            (const struct sockaddr *)&addr, net_connect_cb);
    if (cr < 0) {
        const char *msg = uv_strerror(cr);
        size_t n = strlen(msg);
        char *copy = (char *)GC_malloc_atomic(n + 1);
        memcpy(copy, msg, n + 1);
        s->last_error = copy;
        s->connect_failed = 1;
        uv_close((uv_handle_t *)&s->handle, net_close_cb);
        while (!s->closed) {
            if (uv_run(loop, UV_RUN_ONCE) == 0) break;
        }
        return (void *)s;
    }

    while (!s->connected && !s->connect_failed) {
        if (uv_run(loop, UV_RUN_ONCE) == 0) break;
    }

    if (s->connect_failed) {
        if (!s->close_requested && !s->closed) {
            s->close_requested = 1;
            uv_close((uv_handle_t *)&s->handle, net_close_cb);
            while (!s->closed) {
                if (uv_run(loop, UV_RUN_ONCE) == 0) break;
            }
        }
        return (void *)s;
    }
    return (void *)s;
}

// Return the last error message recorded on the socket, or "" if no error.
const char *cs_net_last_error(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || !s->last_error) return "";
    return s->last_error;
}

// Write bytes asynchronously. The caller's bytes are copied internally so
// the original buffer can be freed/reused immediately. Drives the loop once
// in NOWAIT mode so the write has a chance to flush. Returns 1 on success
// (the write was queued), 0 if the socket is closed/invalid.
double cs_net_write(void *sock, const char *data, double len) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || s->closed || s->close_requested || !s->connected) return 0.0;

    size_t n = (size_t)len;
    char *copy = (char *)malloc(n);
    memcpy(copy, data, n);

    net_write_req_t *wr = (net_write_req_t *)malloc(sizeof(net_write_req_t));
    wr->owned = copy;
    uv_buf_t buf = uv_buf_init(copy, (unsigned int)n);

    int r = uv_write(&wr->req, (uv_stream_t *)&s->handle, &buf, 1, net_write_done);
    if (r < 0) {
        free(copy);
        free(wr);
        return 0.0;
    }
    uv_run(uv_default_loop(), UV_RUN_NOWAIT);
    return 1.0;
}

// Non-blocking poll: tick the loop once, then return the current queued
// event count for this socket.
double cs_net_poll(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s) return 0.0;
    uv_run(uv_default_loop(), UV_RUN_NOWAIT);
    double n = 0.0;
    for (NetEvent *e = s->ev_head; e; e = e->next) n += 1.0;
    return n;
}

// Block up to timeout_ms running the loop until at least one event is queued
// on this socket (or the timeout expires). Returns the queued event count.
// timeout_ms <= 0 behaves like cs_net_poll.
double cs_net_wait(void *sock, double timeout_ms) {
    NetSocket *s = (NetSocket *)sock;
    if (!s) return 0.0;
    uv_loop_t *loop = uv_default_loop();
    if (timeout_ms <= 0.0) {
        uv_run(loop, UV_RUN_NOWAIT);
    } else {
        uint64_t deadline = uv_hrtime() + (uint64_t)(timeout_ms * 1e6);
        while (!s->ev_head) {
            if (uv_hrtime() >= deadline) break;
            if (uv_run(loop, UV_RUN_ONCE) == 0) break;
        }
    }
    double n = 0.0;
    for (NetEvent *e = s->ev_head; e; e = e->next) n += 1.0;
    return n;
}

// Peek the head event kind (NET_EVENT_*). 0 if queue empty.
double cs_net_poll_event_kind(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || !s->ev_head) return 0.0;
    return (double)s->ev_head->kind;
}

// Peek the head event's payload as a char*. Empty string for connect/close
// events or empty queue.
const char *cs_net_poll_event_data(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || !s->ev_head || !s->ev_head->data) return "";
    return s->ev_head->data;
}

// Peek the head event's payload length (0 if none).
double cs_net_poll_event_len(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || !s->ev_head) return 0.0;
    return (double)s->ev_head->data_len;
}

// Pop the head event off the queue. Safe on empty queue.
void cs_net_poll_event_consume(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || !s->ev_head) return;
    NetEvent *head = s->ev_head;
    s->ev_head = head->next;
    if (!s->ev_head) s->ev_tail = NULL;
}

// Half-close: send FIN. Read callback will still fire until peer closes.
// Idempotent.
void cs_net_end(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || s->closed || s->close_requested) return;
    s->close_requested = 1;
    if (s->reading) {
        uv_read_stop((uv_stream_t *)&s->handle);
        s->reading = 0;
    }
    uv_close((uv_handle_t *)&s->handle, net_close_cb);
    uv_run(uv_default_loop(), UV_RUN_NOWAIT);
}

// Hard-close. For plain TCP clients this is equivalent to end() — libuv's
// uv_close already cancels pending writes and fires the close callback.
void cs_net_destroy(void *sock) {
    cs_net_end(sock);
}

// 1 iff the socket is connected and not closing; 0 otherwise.
double cs_net_is_open(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s) return 0.0;
    if (s->closed || s->close_requested || s->connect_failed) return 0.0;
    return s->connected ? 1.0 : 0.0;
}

// Drain and return all currently-buffered inbound bytes as a GC-allocated,
// NUL-terminated string. Clears the rx buffer. Use cs_net_rx_drain_len
// beforehand to learn the exact byte count (the payload may contain
// embedded NULs).
const char *cs_net_rx_drain(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || s->rx_len == 0) return "";
    size_t n = s->rx_len;
    char *out = (char *)GC_malloc_atomic(n + 1);
    memcpy(out, s->rx_buf, n);
    out[n] = '\0';
    s->rx_len = 0;
    return out;
}

double cs_net_rx_drain_len(void *sock) {
    NetSocket *s = (NetSocket *)sock;
    if (!s) return 0.0;
    return (double)s->rx_len;
}
