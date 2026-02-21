#include "lws-bridge.h"
#include <uv.h>
#include <picohttpparser.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <zstd.h>
#include <zlib.h>

#define MAX_WS_CONNS 1024
#define MAX_RESPONSE_SIZE (1024 * 1024)
#define MAX_BODY_SIZE (1024 * 1024)
#define READ_BUF_SIZE 8192
#define WS_GUID "258EAFA5-E914-47DA-95CA-5AC5AB80653E"

static lws_bridge_http_handler g_http_handler = NULL;
static lws_bridge_ws_handler g_ws_handler = NULL;

typedef enum { CONN_HTTP, CONN_WEBSOCKET } conn_type_t;

typedef struct http_conn_s {
    uv_tcp_t handle;
    conn_type_t type;
    char buf[READ_BUF_SIZE];
    size_t data_len;
    char method_str[16];
    char path_str[2048];
    char body[MAX_BODY_SIZE];
    size_t body_len;
    size_t content_length;
    char content_type_str[256];
    char accept_encoding[256];
    char ws_key[64];
    int headers_complete;
    size_t header_end;
} http_conn_t;

static uv_tcp_t *g_ws_conns[MAX_WS_CONNS];
static int g_ws_conn_count = 0;

extern void *GC_malloc(size_t size);
extern void *GC_malloc_atomic(size_t size);

static void ws_track_add(uv_tcp_t *handle) {
    if (g_ws_conn_count < MAX_WS_CONNS) {
        g_ws_conns[g_ws_conn_count++] = handle;
    }
}

static void ws_track_remove(uv_tcp_t *handle) {
    for (int i = 0; i < g_ws_conn_count; i++) {
        if (g_ws_conns[i] == handle) {
            g_ws_conns[i] = g_ws_conns[--g_ws_conn_count];
            return;
        }
    }
}

/* ---- minimal SHA-1 (FIPS 180-4) for WebSocket handshake ---- */

static void sha1(const unsigned char *msg, size_t len, unsigned char out[20]) {
    uint32_t h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE,
             h3 = 0x10325476, h4 = 0xC3D2E1F0;
    size_t new_len = len + 1;
    while (new_len % 64 != 56) new_len++;
    unsigned char *padded = (unsigned char *)calloc(new_len + 8, 1);
    memcpy(padded, msg, len);
    padded[len] = 0x80;
    uint64_t bits = (uint64_t)len * 8;
    for (int i = 0; i < 8; i++)
        padded[new_len + i] = (unsigned char)(bits >> (56 - 8 * i));

    for (size_t offset = 0; offset < new_len + 8; offset += 64) {
        uint32_t w[80];
        for (int i = 0; i < 16; i++)
            w[i] = ((uint32_t)padded[offset + 4*i] << 24) |
                   ((uint32_t)padded[offset + 4*i+1] << 16) |
                   ((uint32_t)padded[offset + 4*i+2] << 8) |
                   ((uint32_t)padded[offset + 4*i+3]);
        for (int i = 16; i < 80; i++) {
            uint32_t v = w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16];
            w[i] = (v << 1) | (v >> 31);
        }
        uint32_t a = h0, b = h1, c = h2, d = h3, e = h4;
        for (int i = 0; i < 80; i++) {
            uint32_t f, k;
            if (i < 20)      { f = (b & c) | (~b & d);           k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d;                    k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d);  k = 0x8F1BBCDC; }
            else              { f = b ^ c ^ d;                    k = 0xCA62C1D6; }
            uint32_t temp = ((a << 5) | (a >> 27)) + f + e + k + w[i];
            e = d; d = c; c = (b << 30) | (b >> 2); b = a; a = temp;
        }
        h0 += a; h1 += b; h2 += c; h3 += d; h4 += e;
    }
    free(padded);
    uint32_t h[5] = {h0, h1, h2, h3, h4};
    for (int i = 0; i < 5; i++) {
        out[4*i]   = (unsigned char)(h[i] >> 24);
        out[4*i+1] = (unsigned char)(h[i] >> 16);
        out[4*i+2] = (unsigned char)(h[i] >> 8);
        out[4*i+3] = (unsigned char)(h[i]);
    }
}

static const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static size_t base64_encode(const unsigned char *in, size_t len, char *out) {
    size_t i, j = 0;
    for (i = 0; i + 2 < len; i += 3) {
        out[j++] = b64_table[in[i] >> 2];
        out[j++] = b64_table[((in[i] & 3) << 4) | (in[i+1] >> 4)];
        out[j++] = b64_table[((in[i+1] & 0xf) << 2) | (in[i+2] >> 6)];
        out[j++] = b64_table[in[i+2] & 0x3f];
    }
    if (i < len) {
        out[j++] = b64_table[in[i] >> 2];
        if (i + 1 < len) {
            out[j++] = b64_table[((in[i] & 3) << 4) | (in[i+1] >> 4)];
            out[j++] = b64_table[(in[i+1] & 0xf) << 2];
        } else {
            out[j++] = b64_table[(in[i] & 3) << 4];
            out[j++] = '=';
        }
        out[j++] = '=';
    }
    out[j] = '\0';
    return j;
}

/* ---- uv helpers ---- */

static void on_close(uv_handle_t *handle) {
    http_conn_t *conn = (http_conn_t *)handle;
    if (conn->type == CONN_WEBSOCKET) {
        ws_track_remove(&conn->handle);
        if (g_ws_handler) {
            char *evt_mem = (char *)GC_malloc(16);
            char **evt = (char **)evt_mem;
            char *empty = (char *)GC_malloc_atomic(1);
            empty[0] = '\0';
            evt[0] = empty;
            char *close_str = (char *)GC_malloc_atomic(6);
            memcpy(close_str, "close", 6);
            evt[1] = close_str;
            g_ws_handler(evt_mem);
        }
    }
    free(conn);
}

static void alloc_buffer(uv_handle_t *handle, size_t suggested, uv_buf_t *buf) {
    http_conn_t *conn = (http_conn_t *)handle;
    size_t avail = READ_BUF_SIZE - conn->data_len;
    buf->base = conn->buf + conn->data_len;
    buf->len = avail > 0 ? avail : 0;
}

typedef struct {
    uv_write_t req;
    char *data;
} write_req_t;

static void on_write_done(uv_write_t *req, int status) {
    write_req_t *wr = (write_req_t *)req;
    free(wr->data);
    free(wr);
}

static void send_raw(uv_tcp_t *handle, const char *data, size_t len) {
    write_req_t *wr = (write_req_t *)malloc(sizeof(write_req_t));
    wr->data = (char *)malloc(len);
    memcpy(wr->data, data, len);
    uv_buf_t buf = uv_buf_init(wr->data, (unsigned int)len);
    uv_write(&wr->req, (uv_stream_t *)handle, &buf, 1, on_write_done);
}

/* ---- HTTP response formatting ---- */

static void send_http_response(http_conn_t *conn, int status, const char *resp_ct,
                                const unsigned char *body, size_t body_len) {
    const unsigned char *send_body = body;
    size_t send_len = body_len;
    const char *content_encoding = NULL;
    unsigned char *comp_buf = NULL;

    if (body_len > 256 && conn->accept_encoding[0]) {
        if (strstr(conn->accept_encoding, "zstd")) {
            size_t zstd_max = ZSTD_compressBound(body_len);
            comp_buf = (unsigned char *)malloc(zstd_max);
            if (comp_buf) {
                size_t zstd_result = ZSTD_compress(comp_buf, zstd_max, body, body_len, 1);
                if (!ZSTD_isError(zstd_result) && zstd_result < body_len) {
                    send_body = comp_buf;
                    send_len = zstd_result;
                    content_encoding = "zstd";
                }
            }
        }
        if (!content_encoding && strstr(conn->accept_encoding, "deflate")) {
            uLong comp_max = compressBound((uLong)body_len);
            comp_buf = (unsigned char *)malloc(comp_max);
            if (comp_buf) {
                uLong dest_len = comp_max;
                int comp_result = compress(comp_buf, &dest_len, (const Bytef *)body, (uLong)body_len);
                if (comp_result == Z_OK && (size_t)dest_len < body_len) {
                    send_body = comp_buf;
                    send_len = (size_t)dest_len;
                    content_encoding = "deflate";
                }
            }
        }
    }

    char header_buf[4096];
    int hlen;
    if (content_encoding) {
        hlen = snprintf(header_buf, sizeof(header_buf),
            "HTTP/1.1 %d OK\r\n"
            "Content-Type: %s\r\n"
            "Content-Length: %zu\r\n"
            "Content-Encoding: %s\r\n"
            "Connection: keep-alive\r\n"
            "\r\n",
            status, resp_ct, send_len, content_encoding);
    } else {
        hlen = snprintf(header_buf, sizeof(header_buf),
            "HTTP/1.1 %d OK\r\n"
            "Content-Type: %s\r\n"
            "Content-Length: %zu\r\n"
            "Connection: keep-alive\r\n"
            "\r\n",
            status, resp_ct, send_len);
    }

    size_t total = (size_t)hlen + send_len;
    write_req_t *wr = (write_req_t *)malloc(sizeof(write_req_t));
    wr->data = (char *)malloc(total);
    memcpy(wr->data, header_buf, (size_t)hlen);
    memcpy(wr->data + hlen, send_body, send_len);
    uv_buf_t buf = uv_buf_init(wr->data, (unsigned int)total);
    uv_write(&wr->req, (uv_stream_t *)&conn->handle, &buf, 1, on_write_done);

    if (comp_buf) free(comp_buf);
}

static const char *sniff_content_type(const char *path, const char *body) {
    const char *dot = strrchr(path, '.');
    if (dot) {
        if (!strcmp(dot, ".css")) return "text/css";
        if (!strcmp(dot, ".js")) return "text/javascript";
        if (!strcmp(dot, ".json")) return "application/json";
        if (!strcmp(dot, ".html") || !strcmp(dot, ".htm")) return "text/html";
        if (!strcmp(dot, ".svg")) return "image/svg+xml";
        if (!strcmp(dot, ".png")) return "image/png";
        if (!strcmp(dot, ".jpg") || !strcmp(dot, ".jpeg")) return "image/jpeg";
        if (!strcmp(dot, ".woff2")) return "font/woff2";
        if (!strcmp(dot, ".wasm")) return "application/wasm";
        if (body && body[0] == '<') return "text/html";
        if (body && (body[0] == '{' || body[0] == '[')) return "application/json";
    } else {
        if (body && body[0] == '<') return "text/html";
        if (body && (body[0] == '{' || body[0] == '[')) return "application/json";
    }
    return "text/plain";
}

/* ---- HTTP request dispatch ---- */

static void dispatch_http_request(http_conn_t *conn) {
    lws_bridge_request req;
    req.method = conn->method_str;
    req.path = conn->path_str;
    req.body = conn->body;
    req.content_type = conn->content_type_str;

    lws_bridge_response resp;
    resp.status = 200;
    resp.body = "";
    resp.body_len = 0;

    g_http_handler(&req, &resp);

    const char *resp_ct = sniff_content_type(req.path, resp.body);
    size_t body_len = resp.body_len > 0 ? (size_t)resp.body_len : (resp.body ? strlen(resp.body) : 0);

    send_http_response(conn, resp.status, resp_ct,
                       (const unsigned char *)resp.body, body_len);
}

/* ---- WebSocket frame handling ---- */

static void ws_send_frame(uv_tcp_t *handle, int opcode, const char *data, size_t len) {
    size_t frame_len = 2 + len;
    if (len > 125) frame_len += 2;
    char *frame = (char *)malloc(frame_len);
    frame[0] = (char)(0x80 | opcode);
    size_t offset;
    if (len <= 125) {
        frame[1] = (char)len;
        offset = 2;
    } else {
        frame[1] = 126;
        frame[2] = (char)((len >> 8) & 0xff);
        frame[3] = (char)(len & 0xff);
        offset = 4;
    }
    memcpy(frame + offset, data, len);

    write_req_t *wr = (write_req_t *)malloc(sizeof(write_req_t));
    wr->data = frame;
    uv_buf_t buf = uv_buf_init(frame, (unsigned int)(offset + len));
    uv_write(&wr->req, (uv_stream_t *)handle, &buf, 1, on_write_done);
}

static void ws_handle_upgrade(http_conn_t *conn) {
    conn->type = CONN_WEBSOCKET;
    ws_track_add(&conn->handle);

    unsigned char concat[256];
    int concat_len = snprintf((char *)concat, sizeof(concat), "%s%s", conn->ws_key, WS_GUID);
    unsigned char hash[20];
    sha1(concat, (size_t)concat_len, hash);
    char accept_key[64];
    base64_encode(hash, 20, accept_key);

    char response[512];
    int rlen = snprintf(response, sizeof(response),
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: %s\r\n"
        "\r\n", accept_key);
    send_raw(&conn->handle, response, (size_t)rlen);

    if (g_ws_handler) {
        char *evt_mem = (char *)GC_malloc(16);
        char **evt = (char **)evt_mem;
        char *empty = (char *)GC_malloc_atomic(1);
        empty[0] = '\0';
        evt[0] = empty;
        char *open_str = (char *)GC_malloc_atomic(5);
        memcpy(open_str, "open", 5);
        evt[1] = open_str;

        char *reply = g_ws_handler(evt_mem);
        if (reply && reply[0]) {
            ws_send_frame(&conn->handle, 0x1, reply, strlen(reply));
        }
    }
}

static void ws_process_frame(http_conn_t *conn) {
    while (conn->data_len >= 2) {
        unsigned char *p = (unsigned char *)conn->buf;
        int fin = p[0] & 0x80;
        int opcode = p[0] & 0x0f;
        int masked = p[1] & 0x80;
        uint64_t payload_len = p[1] & 0x7f;
        size_t header_size = 2;

        if (payload_len == 126) {
            if (conn->data_len < 4) return;
            payload_len = ((uint64_t)p[2] << 8) | p[3];
            header_size = 4;
        } else if (payload_len == 127) {
            if (conn->data_len < 10) return;
            payload_len = 0;
            for (int i = 0; i < 8; i++)
                payload_len = (payload_len << 8) | p[2 + i];
            header_size = 10;
        }

        size_t mask_size = masked ? 4 : 0;
        size_t total_frame = header_size + mask_size + payload_len;
        if (conn->data_len < total_frame) return;

        unsigned char *mask_key = p + header_size;
        unsigned char *payload = p + header_size + mask_size;

        if (masked) {
            for (uint64_t i = 0; i < payload_len; i++)
                payload[i] ^= mask_key[i % 4];
        }

        (void)fin;
        if (opcode == 0x1) {
            if (g_ws_handler) {
                char *data = (char *)GC_malloc_atomic(payload_len + 1);
                memcpy(data, payload, payload_len);
                data[payload_len] = '\0';

                char *evt_mem = (char *)GC_malloc(16);
                char **evt = (char **)evt_mem;
                evt[0] = data;
                char *msg_str = (char *)GC_malloc_atomic(8);
                memcpy(msg_str, "message", 8);
                evt[1] = msg_str;

                char *reply = g_ws_handler(evt_mem);
                if (reply && reply[0]) {
                    ws_send_frame(&conn->handle, 0x1, reply, strlen(reply));
                }
            }
        } else if (opcode == 0x8) {
            ws_send_frame(&conn->handle, 0x8, "", 0);
            uv_close((uv_handle_t *)&conn->handle, on_close);
            return;
        } else if (opcode == 0x9) {
            ws_send_frame(&conn->handle, 0xA, (const char *)payload, (size_t)payload_len);
        }

        size_t remaining = conn->data_len - total_frame;
        if (remaining > 0)
            memmove(conn->buf, conn->buf + total_frame, remaining);
        conn->data_len = remaining;
    }
}

/* ---- HTTP request parsing ---- */

static void try_parse_request(http_conn_t *conn) {
    if (conn->type == CONN_WEBSOCKET) {
        ws_process_frame(conn);
        return;
    }

    if (!conn->headers_complete) {
        const char *method, *path;
        size_t method_len, path_len;
        int minor_version;
        struct phr_header headers[64];
        size_t num_headers = 64;

        int pret = phr_parse_request(conn->buf, conn->data_len,
                                     &method, &method_len,
                                     &path, &path_len,
                                     &minor_version,
                                     headers, &num_headers, 0);
        if (pret == -1) {
            uv_close((uv_handle_t *)&conn->handle, on_close);
            return;
        }
        if (pret == -2) return;

        conn->headers_complete = 1;
        conn->header_end = (size_t)pret;

        size_t ml = method_len < sizeof(conn->method_str) - 1 ? method_len : sizeof(conn->method_str) - 1;
        memcpy(conn->method_str, method, ml);
        conn->method_str[ml] = '\0';

        size_t pl = path_len < sizeof(conn->path_str) - 1 ? path_len : sizeof(conn->path_str) - 1;
        memcpy(conn->path_str, path, pl);
        conn->path_str[pl] = '\0';

        conn->content_length = 0;
        conn->content_type_str[0] = '\0';
        conn->accept_encoding[0] = '\0';
        conn->ws_key[0] = '\0';
        int is_upgrade = 0;

        for (size_t i = 0; i < num_headers; i++) {
            if (headers[i].name_len == 14 &&
                strncasecmp(headers[i].name, "Content-Length", 14) == 0) {
                conn->content_length = (size_t)atol(headers[i].value);
            } else if (headers[i].name_len == 12 &&
                       strncasecmp(headers[i].name, "Content-Type", 12) == 0) {
                size_t cl = headers[i].value_len < sizeof(conn->content_type_str) - 1
                            ? headers[i].value_len : sizeof(conn->content_type_str) - 1;
                memcpy(conn->content_type_str, headers[i].value, cl);
                conn->content_type_str[cl] = '\0';
            } else if (headers[i].name_len == 15 &&
                       strncasecmp(headers[i].name, "Accept-Encoding", 15) == 0) {
                size_t al = headers[i].value_len < sizeof(conn->accept_encoding) - 1
                            ? headers[i].value_len : sizeof(conn->accept_encoding) - 1;
                memcpy(conn->accept_encoding, headers[i].value, al);
                conn->accept_encoding[al] = '\0';
            } else if (headers[i].name_len == 7 &&
                       strncasecmp(headers[i].name, "Upgrade", 7) == 0 &&
                       headers[i].value_len == 9 &&
                       strncasecmp(headers[i].value, "websocket", 9) == 0) {
                is_upgrade = 1;
            } else if (headers[i].name_len == 17 &&
                       strncasecmp(headers[i].name, "Sec-WebSocket-Key", 17) == 0) {
                size_t kl = headers[i].value_len < sizeof(conn->ws_key) - 1
                            ? headers[i].value_len : sizeof(conn->ws_key) - 1;
                memcpy(conn->ws_key, headers[i].value, kl);
                conn->ws_key[kl] = '\0';
            }
        }

        if (is_upgrade && conn->ws_key[0]) {
            size_t remaining = conn->data_len - conn->header_end;
            if (remaining > 0)
                memmove(conn->buf, conn->buf + conn->header_end, remaining);
            conn->data_len = remaining;
            ws_handle_upgrade(conn);
            return;
        }

        size_t body_available = conn->data_len - conn->header_end;
        size_t to_copy = body_available < conn->content_length ? body_available : conn->content_length;
        if (to_copy > MAX_BODY_SIZE - 1) to_copy = MAX_BODY_SIZE - 1;
        if (to_copy > 0) {
            memcpy(conn->body, conn->buf + conn->header_end, to_copy);
        }
        conn->body_len = to_copy;
        conn->body[conn->body_len] = '\0';
    } else {
        size_t body_available = conn->data_len - conn->header_end;
        size_t needed = conn->content_length - conn->body_len;
        size_t to_copy = body_available > needed ? needed : body_available;
        if (conn->body_len + to_copy > MAX_BODY_SIZE - 1)
            to_copy = MAX_BODY_SIZE - 1 - conn->body_len;
        if (to_copy > 0) {
            memcpy(conn->body + conn->body_len, conn->buf + conn->header_end, to_copy);
            conn->body_len += to_copy;
            conn->body[conn->body_len] = '\0';
        }
    }

    if (conn->body_len >= conn->content_length) {
        if (g_http_handler) {
            dispatch_http_request(conn);
        }

        size_t consumed = conn->header_end + conn->content_length;
        size_t remaining = conn->data_len > consumed ? conn->data_len - consumed : 0;
        if (remaining > 0)
            memmove(conn->buf, conn->buf + consumed, remaining);
        conn->data_len = remaining;

        conn->headers_complete = 0;
        conn->header_end = 0;
        conn->body_len = 0;
        conn->content_length = 0;
        conn->content_type_str[0] = '\0';
        conn->accept_encoding[0] = '\0';
        conn->ws_key[0] = '\0';
        conn->method_str[0] = '\0';
        conn->path_str[0] = '\0';
        conn->body[0] = '\0';

        if (remaining > 0) {
            try_parse_request(conn);
        }
    }
}

/* ---- uv callbacks ---- */

static void on_read(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
    http_conn_t *conn = (http_conn_t *)stream;

    if (nread < 0) {
        uv_close((uv_handle_t *)&conn->handle, on_close);
        return;
    }
    if (nread == 0) return;

    conn->data_len += (size_t)nread;
    try_parse_request(conn);
}

static void on_connection(uv_stream_t *server, int status) {
    if (status < 0) return;

    http_conn_t *conn = (http_conn_t *)calloc(1, sizeof(http_conn_t));
    conn->type = CONN_HTTP;

    uv_tcp_init(uv_default_loop(), &conn->handle);
    if (uv_accept(server, (uv_stream_t *)&conn->handle) == 0) {
        uv_tcp_nodelay(&conn->handle, 1);
        uv_read_start((uv_stream_t *)&conn->handle, alloc_buffer, on_read);
    } else {
        uv_close((uv_handle_t *)&conn->handle, on_close);
    }
}

/* ---- public API (same signatures as lws-bridge.h) ---- */

int lws_bridge_serve(int port, lws_bridge_http_handler http_handler,
                     lws_bridge_ws_handler ws_handler) {
    g_http_handler = http_handler;
    g_ws_handler = ws_handler;

    uv_tcp_t server;
    uv_tcp_init(uv_default_loop(), &server);
    uv_tcp_nodelay(&server, 1);

    struct sockaddr_in addr;
    uv_ip4_addr("0.0.0.0", port, &addr);
    uv_tcp_bind(&server, (const struct sockaddr *)&addr, 0);

    int r = uv_listen((uv_stream_t *)&server, 512, on_connection);
    if (r) {
        fprintf(stderr, "Failed to listen on port %d: %s\n", port, uv_strerror(r));
        return 1;
    }

    printf("HTTP server listening on port %d\n", port);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    return 0;
}

void lws_bridge_ws_send(void *wsi_ptr, const char *data, int len) {
    uv_tcp_t *handle = (uv_tcp_t *)wsi_ptr;
    ws_send_frame(handle, 0x1, data, (size_t)len);
}

void lws_bridge_ws_broadcast(const char *data, int len) {
    for (int i = 0; i < g_ws_conn_count; i++) {
        ws_send_frame(g_ws_conns[i], 0x1, data, (size_t)len);
    }
}
