#include <regex.h>
#include <stdlib.h>
#include <string.h>

void *cs_regex_alloc(void) {
    return malloc(sizeof(regex_t));
}

int cs_regex_compile(void *preg, const char *pattern, int cflags) {
    return regcomp((regex_t *)preg, pattern, cflags);
}

void *cs_pmatch_alloc(int ngroups) {
    return calloc(ngroups, sizeof(regmatch_t));
}

int cs_regex_exec(void *preg, const char *string, int ngroups, void *pmatch, int eflags) {
    return regexec((regex_t *)preg, string, (size_t)ngroups, (regmatch_t *)pmatch, eflags);
}

long long cs_pmatch_start(void *pmatch, int idx) {
    return (long long)((regmatch_t *)pmatch)[idx].rm_so;
}

long long cs_pmatch_end(void *pmatch, int idx) {
    return (long long)((regmatch_t *)pmatch)[idx].rm_eo;
}

void cs_regex_free(void *preg) {
    if (preg) {
        regfree((regex_t *)preg);
        free(preg);
    }
}
