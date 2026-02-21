#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/epoll.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <signal.h>

#define MAX_EVENTS 64

static const char RESPONSE[] =
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: text/plain\r\n"
    "Content-Length: 13\r\n"
    "Connection: keep-alive\r\n"
    "\r\n"
    "Hello, World!";

static void set_nonblocking(int fd) {
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
}

int main(int argc, char *argv[]) {
    int port = 3000;
    char *env_port = getenv("PORT");
    if (env_port) port = atoi(env_port);

    signal(SIGPIPE, SIG_IGN);

    int server_fd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
    if (server_fd < 0) { perror("socket"); return 1; }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port);

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind"); return 1;
    }
    if (listen(server_fd, 512) < 0) {
        perror("listen"); return 1;
    }

    int epfd = epoll_create1(0);
    struct epoll_event ev;
    ev.events = EPOLLIN;
    ev.data.fd = server_fd;
    epoll_ctl(epfd, EPOLL_CTL_ADD, server_fd, &ev);

    printf("C HTTP server listening on port %d\n", port);

    struct epoll_event events[MAX_EVENTS];
    char buf[4096];

    for (;;) {
        int n = epoll_wait(epfd, events, MAX_EVENTS, -1);
        for (int i = 0; i < n; i++) {
            int fd = events[i].data.fd;

            if (fd == server_fd) {
                for (;;) {
                    int client = accept4(server_fd, NULL, NULL, SOCK_NONBLOCK);
                    if (client < 0) break;
                    int one = 1;
                    setsockopt(client, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
                    ev.events = EPOLLIN | EPOLLET;
                    ev.data.fd = client;
                    epoll_ctl(epfd, EPOLL_CTL_ADD, client, &ev);
                }
            } else {
                for (;;) {
                    ssize_t nr = read(fd, buf, sizeof(buf));
                    if (nr <= 0) {
                        if (nr == 0 || (errno != EAGAIN && errno != EWOULDBLOCK)) {
                            close(fd);
                        }
                        break;
                    }
                    write(fd, RESPONSE, sizeof(RESPONSE) - 1);
                }
            }
        }
    }

    close(server_fd);
    close(epfd);
    return 0;
}
