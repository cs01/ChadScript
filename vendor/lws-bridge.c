#include "lws-bridge.h"
#include <libwebsockets.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <zstd.h>
#include <zlib.h>

#define MAX_WS_CONNS 1024
#define MAX_RESPONSE_SIZE (1024 * 1024)
#define MAX_BODY_SIZE (1024 * 1024)

static lws_bridge_http_handler g_http_handler = NULL;
static lws_bridge_ws_handler g_ws_handler = NULL;

static struct lws *g_ws_conns[MAX_WS_CONNS];
static int g_ws_conn_count = 0;

struct per_session_http {
    char body[MAX_BODY_SIZE];
    int body_len;
    char method[16];
    char path[2048];
    int complete;
};

struct per_session_ws {
    int established;
};

extern void *GC_malloc(size_t size);
extern void *GC_malloc_atomic(size_t size);

static void ws_track_add(struct lws *wsi) {
    if (g_ws_conn_count < MAX_WS_CONNS) {
        g_ws_conns[g_ws_conn_count++] = wsi;
    }
}

static void ws_track_remove(struct lws *wsi) {
    for (int i = 0; i < g_ws_conn_count; i++) {
        if (g_ws_conns[i] == wsi) {
            g_ws_conns[i] = g_ws_conns[--g_ws_conn_count];
            return;
        }
    }
}

static int callback_http(struct lws *wsi, enum lws_callback_reasons reason,
                         void *user, void *in, size_t len) {
    struct per_session_http *pss = (struct per_session_http *)user;

    switch (reason) {
    case LWS_CALLBACK_HTTP: {
        if (!g_http_handler) return -1;

        pss->body_len = 0;
        pss->body[0] = '\0';
        pss->complete = 0;

        int meth_len = lws_hdr_total_length(wsi, WSI_TOKEN_HTTP_COLON_METHOD);
        if (meth_len > 0) {
            lws_hdr_copy(wsi, pss->method, sizeof(pss->method), WSI_TOKEN_HTTP_COLON_METHOD);
        } else if (lws_hdr_total_length(wsi, WSI_TOKEN_GET_URI) > 0) {
            strcpy(pss->method, "GET");
        } else if (lws_hdr_total_length(wsi, WSI_TOKEN_POST_URI) > 0) {
            strcpy(pss->method, "POST");
        } else if (lws_hdr_total_length(wsi, WSI_TOKEN_PUT_URI) > 0) {
            strcpy(pss->method, "PUT");
        } else if (lws_hdr_total_length(wsi, WSI_TOKEN_DELETE_URI) > 0) {
            strcpy(pss->method, "DELETE");
        } else if (lws_hdr_total_length(wsi, WSI_TOKEN_PATCH_URI) > 0) {
            strcpy(pss->method, "PATCH");
        } else {
            strcpy(pss->method, "GET");
        }

        if (in) {
            size_t path_len = len < sizeof(pss->path) - 1 ? len : sizeof(pss->path) - 1;
            memcpy(pss->path, in, path_len);
            pss->path[path_len] = '\0';
        } else {
            pss->path[0] = '/';
            pss->path[1] = '\0';
        }

        int args_len = lws_hdr_total_length(wsi, WSI_TOKEN_HTTP_URI_ARGS);
        if (args_len > 0) {
            size_t cur_len = strlen(pss->path);
            if (cur_len + 1 + args_len < sizeof(pss->path) - 1) {
                pss->path[cur_len] = '?';
                lws_hdr_copy(wsi, pss->path + cur_len + 1,
                             sizeof(pss->path) - cur_len - 1,
                             WSI_TOKEN_HTTP_URI_ARGS);
            }
        }

        int content_len = lws_hdr_total_length(wsi, WSI_TOKEN_HTTP_CONTENT_LENGTH);
        if (content_len > 0) {
            return 0;
        }

        pss->complete = 1;
        goto do_response;
    }

    case LWS_CALLBACK_HTTP_BODY: {
        if (pss->body_len + (int)len < MAX_BODY_SIZE) {
            memcpy(pss->body + pss->body_len, in, len);
            pss->body_len += (int)len;
            pss->body[pss->body_len] = '\0';
        }
        return 0;
    }

    case LWS_CALLBACK_HTTP_BODY_COMPLETION: {
        pss->complete = 1;
        goto do_response;
    }

    default:
        break;
    }
    return lws_callback_http_dummy(wsi, reason, user, in, len);

do_response: {
        char *method_str = (char *)GC_malloc_atomic(strlen(pss->method) + 1);
        strcpy(method_str, pss->method);

        char *path_str = (char *)GC_malloc_atomic(strlen(pss->path) + 1);
        strcpy(path_str, pss->path);

        char *body_str = (char *)GC_malloc_atomic(pss->body_len + 1);
        memcpy(body_str, pss->body, pss->body_len);
        body_str[pss->body_len] = '\0';

        char ct_buf[256] = "";
        lws_hdr_copy(wsi, ct_buf, sizeof(ct_buf), WSI_TOKEN_HTTP_CONTENT_TYPE);
        char *ct_str = (char *)GC_malloc_atomic(strlen(ct_buf) + 1);
        strcpy(ct_str, ct_buf);

        lws_bridge_request req;
        req.method = method_str;
        req.path = path_str;
        req.body = body_str;
        req.content_type = ct_str;

        lws_bridge_response resp;
        resp.status = 200;
        resp.body = "";
        resp.body_len = 0;

        g_http_handler(&req, &resp);

        const char *resp_ct = "text/plain";
        if (resp.body && resp.body[0] == '<') resp_ct = "text/html";
        else if (resp.body && (resp.body[0] == '{' || resp.body[0] == '[')) resp_ct = "application/json";

        size_t body_len = resp.body_len > 0 ? (size_t)resp.body_len : (resp.body ? strlen(resp.body) : 0);

        const unsigned char *send_body = (const unsigned char *)resp.body;
        size_t send_len = body_len;
        const char *content_encoding = NULL;
        unsigned char *comp_buf = NULL;

        if (body_len > 256) {
            char ae_buf[256] = "";
            lws_hdr_copy(wsi, ae_buf, sizeof(ae_buf), WSI_TOKEN_HTTP_ACCEPT_ENCODING);

            if (ae_buf[0]) {
                if (strstr(ae_buf, "zstd")) {
                    size_t zstd_max = ZSTD_compressBound(body_len);
                    comp_buf = (unsigned char *)malloc(zstd_max);
                    if (comp_buf) {
                        size_t zstd_result = ZSTD_compress(comp_buf, zstd_max, resp.body, body_len, 1);
                        if (!ZSTD_isError(zstd_result) && zstd_result < body_len) {
                            send_body = comp_buf;
                            send_len = zstd_result;
                            content_encoding = "zstd";
                        }
                    }
                }
                if (!content_encoding && strstr(ae_buf, "deflate")) {
                    uLong comp_max = compressBound((uLong)body_len);
                    comp_buf = (unsigned char *)malloc(comp_max);
                    if (comp_buf) {
                        uLong dest_len = comp_max;
                        int comp_result = compress(comp_buf, &dest_len, (const Bytef *)resp.body, (uLong)body_len);
                        if (comp_result == Z_OK && (size_t)dest_len < body_len) {
                            send_body = comp_buf;
                            send_len = (size_t)dest_len;
                            content_encoding = "deflate";
                        }
                    }
                }
            }
        }

        unsigned char headers[LWS_PRE + 4096];
        unsigned char *p = headers + LWS_PRE;
        unsigned char *end = headers + sizeof(headers) - 1;

        if (lws_add_http_common_headers(wsi, resp.status, resp_ct, send_len, &p, end))
            return 1;

        if (content_encoding) {
            if (lws_add_http_header_by_token(wsi, WSI_TOKEN_HTTP_CONTENT_ENCODING,
                    (const unsigned char *)content_encoding, (int)strlen(content_encoding), &p, end))
                return 1;
        }

        if (lws_finalize_write_http_header(wsi, headers + LWS_PRE, &p, end))
            return 1;

        unsigned char *buf = (unsigned char *)malloc(LWS_PRE + send_len);
        if (!buf) { if (comp_buf) free(comp_buf); return 1; }
        memcpy(buf + LWS_PRE, send_body, send_len);
        lws_write(wsi, buf + LWS_PRE, send_len, LWS_WRITE_HTTP_FINAL);
        free(buf);
        if (comp_buf) free(comp_buf);

        if (lws_http_transaction_completed(wsi))
            return -1;

        return 0;
    }
}

static int callback_ws(struct lws *wsi, enum lws_callback_reasons reason,
                       void *user, void *in, size_t len) {
    struct per_session_ws *pss = (struct per_session_ws *)user;

    switch (reason) {
    case LWS_CALLBACK_ESTABLISHED: {
        pss->established = 1;
        ws_track_add(wsi);

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
                size_t rlen = strlen(reply);
                unsigned char *buf = (unsigned char *)malloc(LWS_PRE + rlen);
                if (buf) {
                    memcpy(buf + LWS_PRE, reply, rlen);
                    lws_write(wsi, buf + LWS_PRE, rlen, LWS_WRITE_TEXT);
                    free(buf);
                }
            }
        }
        break;
    }

    case LWS_CALLBACK_RECEIVE: {
        if (!g_ws_handler) break;

        char *data = (char *)GC_malloc_atomic(len + 1);
        memcpy(data, in, len);
        data[len] = '\0';

        char *evt_mem = (char *)GC_malloc(16);
        char **evt = (char **)evt_mem;
        evt[0] = data;
        char *msg_str = (char *)GC_malloc_atomic(8);
        memcpy(msg_str, "message", 8);
        evt[1] = msg_str;

        char *reply = g_ws_handler(evt_mem);
        if (reply && reply[0]) {
            size_t rlen = strlen(reply);
            unsigned char *buf = (unsigned char *)malloc(LWS_PRE + rlen);
            if (buf) {
                memcpy(buf + LWS_PRE, reply, rlen);
                lws_write(wsi, buf + LWS_PRE, rlen, LWS_WRITE_TEXT);
                free(buf);
            }
        }
        break;
    }

    case LWS_CALLBACK_CLOSED: {
        ws_track_remove(wsi);

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
        break;
    }

    default:
        break;
    }
    return 0;
}

static struct lws_protocols protocols[] = {
    { "http", callback_http, sizeof(struct per_session_http), 0, 0, NULL, 0 },
    { "ws", callback_ws, sizeof(struct per_session_ws), 65536, 0, NULL, 0 },
    LWS_PROTOCOL_LIST_TERM
};

int lws_bridge_serve(int port, lws_bridge_http_handler http_handler,
                     lws_bridge_ws_handler ws_handler) {
    g_http_handler = http_handler;
    g_ws_handler = ws_handler;

    struct lws_context_creation_info info;
    memset(&info, 0, sizeof(info));
    info.port = port;
    info.protocols = protocols;
    info.options = LWS_SERVER_OPTION_HTTP_HEADERS_SECURITY_BEST_PRACTICES_ENFORCE |
                   LWS_SERVER_OPTION_ALLOW_HTTP_ON_HTTPS_LISTENER;

    struct lws_context *context = lws_create_context(&info);
    if (!context) {
        fprintf(stderr, "Failed to create lws context on port %d\n", port);
        return 1;
    }

    printf("HTTP server listening on port %d\n", port);

    while (1) {
        lws_service(context, 0);
    }

    lws_context_destroy(context);
    return 0;
}

void lws_bridge_ws_send(void *wsi_ptr, const char *data, int len) {
    struct lws *wsi = (struct lws *)wsi_ptr;
    unsigned char *buf = (unsigned char *)malloc(LWS_PRE + len);
    if (!buf) return;
    memcpy(buf + LWS_PRE, data, len);
    lws_write(wsi, buf + LWS_PRE, len, LWS_WRITE_TEXT);
    free(buf);
}

void lws_bridge_ws_broadcast(const char *data, int len) {
    for (int i = 0; i < g_ws_conn_count; i++) {
        unsigned char *buf = (unsigned char *)malloc(LWS_PRE + len);
        if (!buf) continue;
        memcpy(buf + LWS_PRE, data, len);
        lws_write(g_ws_conns[i], buf + LWS_PRE, len, LWS_WRITE_TEXT);
        free(buf);
    }
}
