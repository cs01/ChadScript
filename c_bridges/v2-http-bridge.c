#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <uv.h>

typedef struct {
    char* method;
    char* url;
    char* body;
} HttpRequest;

typedef struct {
    int client_fd;
    int status_code;
    char* content_type;
    int headers_sent;
} HttpResponse;

typedef struct {
    void (*fn_ptr)(void* env, HttpRequest* req, HttpResponse* res);
    void* env_ptr;
    uv_tcp_t server;
    uv_loop_t* loop;
} HttpServer;

static void parse_request(const char* raw, HttpRequest* req) {
    req->method = NULL;
    req->url = NULL;
    req->body = NULL;

    const char* space1 = strchr(raw, ' ');
    if (!space1) return;
    size_t method_len = space1 - raw;
    req->method = (char*)malloc(method_len + 1);
    memcpy(req->method, raw, method_len);
    req->method[method_len] = '\0';

    const char* url_start = space1 + 1;
    const char* space2 = strchr(url_start, ' ');
    if (!space2) return;
    size_t url_len = space2 - url_start;
    req->url = (char*)malloc(url_len + 1);
    memcpy(req->url, url_start, url_len);
    req->url[url_len] = '\0';

    const char* body_sep = strstr(raw, "\r\n\r\n");
    if (body_sep) {
        req->body = strdup(body_sep + 4);
    } else {
        req->body = strdup("");
    }
}

static void on_alloc(uv_handle_t* handle, size_t suggested, uv_buf_t* buf) {
    buf->base = (char*)malloc(suggested);
    buf->len = suggested;
}

static void on_write_done(uv_write_t* req, int status) {
    free(req->data);
    free(req);
}

void cs2_http_res_write_head(HttpResponse* res, double status, const char* content_type) {
    res->status_code = (int)status;
    if (res->content_type) free(res->content_type);
    res->content_type = strdup(content_type);
}

void cs2_http_res_end(HttpResponse* res, const char* body) {
    const char* ct = res->content_type ? res->content_type : "text/plain";
    int status = res->status_code > 0 ? res->status_code : 200;
    size_t body_len = body ? strlen(body) : 0;

    size_t header_cap = 256 + strlen(ct);
    char* header = (char*)malloc(header_cap);
    int hdr_len = snprintf(header, header_cap,
        "HTTP/1.1 %d OK\r\nContent-Type: %s\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n",
        status, ct, body_len);

    size_t total = hdr_len + body_len;
    char* buf = (char*)malloc(total);
    memcpy(buf, header, hdr_len);
    if (body_len > 0) memcpy(buf + hdr_len, body, body_len);
    free(header);

    write(res->client_fd, buf, total);
    free(buf);
    close(res->client_fd);

    if (res->content_type) free(res->content_type);
    free(res);
}

static void on_read(uv_stream_t* client, ssize_t nread, const uv_buf_t* buf) {
    HttpServer* server = (HttpServer*)client->data;

    if (nread <= 0) {
        if (buf->base) free(buf->base);
        uv_close((uv_handle_t*)client, (uv_close_cb)free);
        return;
    }

    buf->base[nread] = '\0';

    HttpRequest* req = (HttpRequest*)malloc(sizeof(HttpRequest));
    parse_request(buf->base, req);

    int fd;
    uv_fileno((uv_handle_t*)client, &fd);
    int client_fd = dup(fd);

    HttpResponse* res = (HttpResponse*)malloc(sizeof(HttpResponse));
    res->client_fd = client_fd;
    res->status_code = 200;
    res->content_type = NULL;
    res->headers_sent = 0;

    server->fn_ptr(server->env_ptr, req, res);

    if (req->method) free(req->method);
    if (req->url) free(req->url);
    if (req->body) free(req->body);
    free(req);

    free(buf->base);
    uv_close((uv_handle_t*)client, (uv_close_cb)free);
}

static void on_connection(uv_stream_t* server_handle, int status) {
    if (status < 0) return;

    HttpServer* server = (HttpServer*)server_handle->data;

    uv_tcp_t* client = (uv_tcp_t*)malloc(sizeof(uv_tcp_t));
    uv_tcp_init(server->loop, client);
    client->data = server;

    if (uv_accept(server_handle, (uv_stream_t*)client) == 0) {
        uv_read_start((uv_stream_t*)client, on_alloc, on_read);
    } else {
        uv_close((uv_handle_t*)client, (uv_close_cb)free);
    }
}

void* cs2_http_create_server(void* closure_ptr) {
    void** closure = (void**)closure_ptr;

    HttpServer* server = (HttpServer*)malloc(sizeof(HttpServer));
    server->fn_ptr = (void (*)(void*, HttpRequest*, HttpResponse*))closure[0];
    server->env_ptr = closure[1];
    server->loop = uv_default_loop();

    return server;
}

void cs2_http_server_listen(void* server_ptr, double port, void* callback_ptr) {
    HttpServer* server = (HttpServer*)server_ptr;

    uv_tcp_init(server->loop, &server->server);
    server->server.data = server;

    struct sockaddr_in addr;
    uv_ip4_addr("0.0.0.0", (int)port, &addr);
    uv_tcp_bind(&server->server, (const struct sockaddr*)&addr, 0);

    int r = uv_listen((uv_stream_t*)&server->server, 128, on_connection);
    if (r) {
        fprintf(stderr, "listen error: %s\n", uv_strerror(r));
        return;
    }

    if (callback_ptr) {
        void** cb = (void**)callback_ptr;
        void (*cb_fn)(void*) = (void (*)(void*))cb[0];
        void* cb_env = cb[1];
        cb_fn(cb_env);
    }
}

void cs2_http_server_close(void* server_ptr) {
    HttpServer* server = (HttpServer*)server_ptr;
    uv_close((uv_handle_t*)&server->server, NULL);
}

const char* cs2_http_req_method(HttpRequest* req) {
    return req->method ? req->method : "";
}

const char* cs2_http_req_url(HttpRequest* req) {
    return req->url ? req->url : "/";
}

char* cs2_fetch_sync(const char* url) {
    const char* host_start = url;
    int use_https = 0;

    if (strncmp(url, "http://", 7) == 0) {
        host_start = url + 7;
    } else if (strncmp(url, "https://", 8) == 0) {
        host_start = url + 8;
        use_https = 1;
    }

    if (use_https) {
        return strdup("error: https not supported in sync fetch");
    }

    char host[256];
    char path[2048];
    int port = 80;

    const char* path_start = strchr(host_start, '/');
    const char* port_start = strchr(host_start, ':');

    if (port_start && (!path_start || port_start < path_start)) {
        size_t hlen = port_start - host_start;
        if (hlen >= sizeof(host)) hlen = sizeof(host) - 1;
        memcpy(host, host_start, hlen);
        host[hlen] = '\0';
        port = atoi(port_start + 1);
    } else if (path_start) {
        size_t hlen = path_start - host_start;
        if (hlen >= sizeof(host)) hlen = sizeof(host) - 1;
        memcpy(host, host_start, hlen);
        host[hlen] = '\0';
    } else {
        strncpy(host, host_start, sizeof(host) - 1);
        host[sizeof(host) - 1] = '\0';
    }

    if (path_start) {
        strncpy(path, path_start, sizeof(path) - 1);
        path[sizeof(path) - 1] = '\0';
    } else {
        strcpy(path, "/");
    }

    struct addrinfo hints, *res;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    char port_str[16];
    snprintf(port_str, sizeof(port_str), "%d", port);

    if (getaddrinfo(host, port_str, &hints, &res) != 0) {
        return strdup("error: could not resolve host");
    }

    int sock = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (sock < 0) {
        freeaddrinfo(res);
        return strdup("error: could not create socket");
    }

    if (connect(sock, res->ai_addr, res->ai_addrlen) < 0) {
        freeaddrinfo(res);
        close(sock);
        return strdup("error: could not connect");
    }
    freeaddrinfo(res);

    char request[4096];
    snprintf(request, sizeof(request),
        "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n",
        path, host);

    send(sock, request, strlen(request), 0);

    size_t capacity = 4096;
    size_t length = 0;
    char* buffer = (char*)malloc(capacity);
    char chunk[4096];
    ssize_t n;

    while ((n = recv(sock, chunk, sizeof(chunk), 0)) > 0) {
        if (length + n + 1 > capacity) {
            capacity = (length + n + 1) * 2;
            buffer = (char*)realloc(buffer, capacity);
        }
        memcpy(buffer + length, chunk, n);
        length += n;
    }
    buffer[length] = '\0';
    close(sock);

    char* body_start = strstr(buffer, "\r\n\r\n");
    if (body_start) {
        char* body = strdup(body_start + 4);
        free(buffer);
        return body;
    }

    return buffer;
}
