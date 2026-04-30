#include <signal.h>
#include <string.h>
#include <unistd.h>
#include <stdlib.h>
#include <pthread.h>

static char cs2_alt_stack[65536];
static struct sigaction cs2_old_sigsegv;

static int cs2_is_stack_overflow(siginfo_t *info) {
    void *fault = info->si_addr;
    if (!fault) return 0;

#ifdef __APPLE__
    void *stack_top = pthread_get_stackaddr_np(pthread_self());
    size_t stack_size = pthread_get_stacksize_np(pthread_self());
    void *stack_bottom = (char *)stack_top - stack_size;
    return fault >= (char *)stack_bottom - 4096 && fault < (char *)stack_top;
#else
    pthread_attr_t attr;
    void *stack_addr = NULL;
    size_t stack_size = 0;
    if (pthread_getattr_np(pthread_self(), &attr) == 0) {
        pthread_attr_getstack(&attr, &stack_addr, &stack_size);
        pthread_attr_destroy(&attr);
    }
    return stack_addr && fault >= (char *)stack_addr - 4096 &&
           fault < (char *)stack_addr + 4096;
#endif
}

static void cs2_sigsegv_handler(int sig, siginfo_t *info, void *ctx) {
    if (cs2_is_stack_overflow(info)) {
        const char msg[] = "Maximum call stack size exceeded\n";
        write(STDERR_FILENO, msg, sizeof(msg) - 1);
        _exit(1);
    }
    sigaction(SIGSEGV, &cs2_old_sigsegv, NULL);
    raise(SIGSEGV);
}

__attribute__((constructor))
static void cs2_init_stack_guard(void) {
    stack_t ss;
    ss.ss_sp = cs2_alt_stack;
    ss.ss_size = sizeof(cs2_alt_stack);
    ss.ss_flags = 0;
    sigaltstack(&ss, NULL);

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = cs2_sigsegv_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
    sigaction(SIGSEGV, &sa, &cs2_old_sigsegv);
}
