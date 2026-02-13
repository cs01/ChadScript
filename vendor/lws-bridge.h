#ifndef LWS_BRIDGE_H
#define LWS_BRIDGE_H

#include <stdint.h>

typedef struct {
    const char *method;
    const char *path;
    const char *body;
    const char *content_type;
} lws_bridge_request;

typedef struct {
    int status;
    const char *body;
    int64_t body_len;
} lws_bridge_response;

typedef void (*lws_bridge_http_handler)(lws_bridge_request *req, lws_bridge_response *resp);
typedef char* (*lws_bridge_ws_handler)(void *event);

int lws_bridge_serve(int port, lws_bridge_http_handler http_handler, lws_bridge_ws_handler ws_handler);
void lws_bridge_ws_send(void *wsi, const char *data, int len);
void lws_bridge_ws_broadcast(const char *data, int len);

#endif
