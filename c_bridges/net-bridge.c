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

#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/bio.h>
#include <openssl/x509v3.h>

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

    // TLS state. NULL until upgraded via cs_tls_upgrade / cs_tls_connect.
    // rbio holds ciphertext bytes received from the peer (fed from net_read_cb);
    // wbio receives ciphertext that SSL wants to send (drained into uv_write).
    SSL *ssl;
    BIO *rbio;
    BIO *wbio;
    int tls_handshaking;
    int tls_error;
} NetSocket;

// Global SSL_CTX — one per (verify-mode) for the whole process. TLS client
// contexts are thread-safe-to-reuse once initialized, and all client
// connections share identical configuration, so caching avoids per-connect
// SSL_CTX_new cost (~ms on first call due to default CA load).
static SSL_CTX *g_ssl_ctx_verify = NULL;
static SSL_CTX *g_ssl_ctx_noverify = NULL;
static int g_ssl_inited = 0;

static void ensure_ssl_inited(void) {
    if (g_ssl_inited) return;
    SSL_library_init();
    SSL_load_error_strings();
    OpenSSL_add_all_algorithms();
    g_ssl_inited = 1;
}

static SSL_CTX *ensure_ssl_ctx(int verify) {
    ensure_ssl_inited();
    SSL_CTX **slot = verify ? &g_ssl_ctx_verify : &g_ssl_ctx_noverify;
    if (*slot) return *slot;
    SSL_CTX *ctx = SSL_CTX_new(TLS_client_method());
    if (!ctx) return NULL;
    SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
    SSL_CTX_set_mode(ctx, SSL_MODE_ENABLE_PARTIAL_WRITE | SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
    if (verify) {
        SSL_CTX_set_default_verify_paths(ctx);
        SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);
    } else {
        SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL);
    }
    *slot = ctx;
    return ctx;
}

static void set_last_error_gc(NetSocket *s, const char *msg) {
    if (!msg) msg = "unknown tls error";
    size_t n = strlen(msg);
    char *copy = (char *)GC_malloc_atomic(n + 1);
    memcpy(copy, msg, n + 1);
    s->last_error = copy;
}


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

// Forward declarations for TLS helpers (defined after net_write_done so they
// can reference net_write_req_t, but called from net_read_cb above).
struct NetSocket;
static int tls_handshake_pump(NetSocket *s);
static void tls_drain_ssl_read(NetSocket *s);
static int tls_flush_wbio(NetSocket *s);

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
        if (s->ssl) {
            // TLS path: feed ciphertext into rbio, then either advance the
            // handshake or drain plaintext (whichever state we're in).
            BIO_write(s->rbio, buf->base, (int)nread);
            if (s->tls_handshaking) {
                tls_handshake_pump(s);
            } else {
                tls_drain_ssl_read(s);
            }
        } else {
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
        }
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

// ---- TLS helpers ----
//
// The TLS path layers on top of the plain-TCP plumbing without forking the
// event loop or event queue. Bytes arriving from the peer land in rbio via
// net_read_cb; SSL_read drains them into plaintext and we enqueue DATA
// events exactly like the plain path. Outbound plaintext goes into SSL_write,
// which pushes ciphertext into wbio, which we drain into uv_write.

// Drain wbio (ciphertext SSL produced) into uv_write. Returns 0 on success
// (even if nothing to write), negative libuv errno on write submission fail.
static int tls_flush_wbio(NetSocket *s) {
    if (!s->ssl) return 0;
    int pending = BIO_pending(s->wbio);
    if (pending <= 0) return 0;
    char *buf = (char *)malloc((size_t)pending);
    int got = BIO_read(s->wbio, buf, pending);
    if (got <= 0) { free(buf); return 0; }
    net_write_req_t *wr = (net_write_req_t *)malloc(sizeof(net_write_req_t));
    wr->owned = buf;
    uv_buf_t ub = uv_buf_init(buf, (unsigned int)got);
    int r = uv_write(&wr->req, (uv_stream_t *)&s->handle, &ub, 1, net_write_done);
    if (r < 0) { free(buf); free(wr); return r; }
    return 0;
}

// Drain decrypted plaintext out of SSL and push it into rx_buf + DATA events.
// Idempotent — caller invokes after every rbio feed.
static void tls_drain_ssl_read(NetSocket *s) {
    if (!s->ssl) return;
    char tmp[4096];
    for (;;) {
        int n = SSL_read(s->ssl, tmp, sizeof(tmp));
        if (n <= 0) {
            int err = SSL_get_error(s->ssl, n);
            if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) return;
            if (err == SSL_ERROR_ZERO_RETURN) return;
            return;
        }
        size_t needed = s->rx_len + (size_t)n;
        if (needed > s->rx_cap) {
            size_t newcap = s->rx_cap > 0 ? s->rx_cap : 4096;
            while (newcap < needed) newcap *= 2;
            char *nb = (char *)malloc(newcap);
            if (s->rx_len > 0) memcpy(nb, s->rx_buf, s->rx_len);
            free(s->rx_buf);
            s->rx_buf = nb;
            s->rx_cap = newcap;
        }
        memcpy(s->rx_buf + s->rx_len, tmp, (size_t)n);
        s->rx_len += (size_t)n;
        net_enqueue(s, NET_EVENT_DATA, tmp, (size_t)n);
    }
}

// Pump the handshake forward. Returns 1 on complete, 0 if still in progress,
// -1 on fatal error.
static int tls_handshake_pump(NetSocket *s) {
    if (!s->ssl) return -1;
    int r = SSL_do_handshake(s->ssl);
    // Always flush any bytes SSL produced (ClientHello, Finished, etc).
    tls_flush_wbio(s);
    if (r == 1) {
        s->tls_handshaking = 0;
        return 1;
    }
    int err = SSL_get_error(s->ssl, r);
    if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) return 0;
    s->tls_error = 1;
    unsigned long e = ERR_get_error();
    char errbuf[256];
    if (e) {
        ERR_error_string_n(e, errbuf, sizeof(errbuf));
    } else {
        snprintf(errbuf, sizeof(errbuf), "tls handshake failed (ssl err %d)", err);
    }
    set_last_error_gc(s, errbuf);
    net_enqueue(s, NET_EVENT_ERROR, errbuf, strlen(errbuf));
    return -1;
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

    if (s->ssl) {
        // TLS: encrypt through SSL_write (ciphertext lands in wbio), then
        // drain wbio into uv_write. Partial-write mode is enabled on the
        // CTX so SSL_write returns as soon as >=1 byte is buffered.
        size_t off = 0;
        while (off < n) {
            int w = SSL_write(s->ssl, data + off, (int)(n - off));
            if (w <= 0) {
                int err = SSL_get_error(s->ssl, w);
                if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) {
                    // Shouldn't happen with memory BIOs + partial writes on
                    // a post-handshake socket, but treat as transient.
                    break;
                }
                s->tls_error = 1;
                set_last_error_gc(s, "SSL_write failed");
                return 0.0;
            }
            off += (size_t)w;
        }
        int fr = tls_flush_wbio(s);
        if (fr < 0) return 0.0;
        uv_run(uv_default_loop(), UV_RUN_NOWAIT);
        return 1.0;
    }

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

// ---- TLS public API ----

// Upgrade an already-connected plain socket to TLS. Used for STARTTLS-style
// protocols (Postgres SSLRequest, SMTP STARTTLS, IMAP STARTTLS). Drives the
// handshake synchronously by spinning UV_RUN_ONCE until SSL_do_handshake
// reports complete or errors out. Returns 1 on success, 0 on failure (with
// last_error set to the OpenSSL error string).
//
// Preconditions: socket must be connected, not closed, and must not have any
// unread ciphertext buffered in rx_buf (i.e. the STARTTLS reply byte must
// have already been consumed by the caller before the upgrade). The rx_buf
// is left untouched — post-upgrade reads land as plaintext there.
double cs_tls_upgrade(void *sock, const char *servername, double verify) {
    NetSocket *s = (NetSocket *)sock;
    if (!s || s->closed || s->close_requested || !s->connected) return 0.0;
    if (s->ssl) return 1.0;  // idempotent

    SSL_CTX *ctx = ensure_ssl_ctx((int)verify);
    if (!ctx) {
        set_last_error_gc(s, "SSL_CTX_new failed");
        return 0.0;
    }
    s->rbio = BIO_new(BIO_s_mem());
    s->wbio = BIO_new(BIO_s_mem());
    s->ssl = SSL_new(ctx);
    if (!s->ssl || !s->rbio || !s->wbio) {
        set_last_error_gc(s, "SSL_new failed");
        return 0.0;
    }
    SSL_set_bio(s->ssl, s->rbio, s->wbio);
    if (servername && servername[0]) {
        SSL_set_tlsext_host_name(s->ssl, servername);
        // X509 hostname check
        if ((int)verify) {
            X509_VERIFY_PARAM *param = SSL_get0_param(s->ssl);
            X509_VERIFY_PARAM_set_hostflags(param, X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS);
            X509_VERIFY_PARAM_set1_host(param, servername, 0);
        }
    }
    SSL_set_connect_state(s->ssl);
    s->tls_handshaking = 1;
    s->tls_error = 0;

    // Kick off: SSL_do_handshake emits ClientHello into wbio; flush, then
    // tick the loop until the handshake completes or errors.
    int pump = tls_handshake_pump(s);
    uv_loop_t *loop = uv_default_loop();
    uint64_t deadline = uv_hrtime() + (uint64_t)(30ull * 1000ull * 1000000ull);  // 30s
    while (pump == 0 && !s->tls_error && !s->closed && !s->close_requested) {
        if (uv_hrtime() >= deadline) {
            set_last_error_gc(s, "tls handshake timeout");
            s->tls_error = 1;
            break;
        }
        if (uv_run(loop, UV_RUN_ONCE) == 0) break;
        // net_read_cb will feed rbio and call tls_handshake_pump already.
        if (!s->tls_handshaking) { pump = 1; break; }
        if (s->tls_error) { pump = -1; break; }
    }
    if (pump != 1 || s->tls_error) {
        // Tear down TLS state; socket stays open so caller can close cleanly.
        SSL_free(s->ssl);
        s->ssl = NULL;
        s->rbio = NULL;
        s->wbio = NULL;
        s->tls_handshaking = 0;
        return 0.0;
    }
    return 1.0;
}

// Open a TLS connection in one call: plain connect then upgrade. For
// implicit-TLS protocols (HTTPS, MQTTS, pg with sslmode=require-no-starttls).
// Returns the same NetSocket* as cs_net_connect — on failure the socket has
// connect_failed or tls_error set and closed=1.
void *cs_tls_connect(const char *host, double port, const char *servername, double verify) {
    void *sock = cs_net_connect(host, port);
    NetSocket *s = (NetSocket *)sock;
    if (!s || !s->connected) return sock;
    double up = cs_tls_upgrade(sock, servername, verify);
    if (up <= 0.0) {
        // Upgrade failed — close the underlying socket so caller sees a dead
        // handle, matching connect-failure semantics.
        if (!s->close_requested && !s->closed) {
            s->close_requested = 1;
            uv_close((uv_handle_t *)&s->handle, net_close_cb);
            while (!s->closed) {
                if (uv_run(uv_default_loop(), UV_RUN_ONCE) == 0) break;
            }
        }
    }
    return sock;
}
