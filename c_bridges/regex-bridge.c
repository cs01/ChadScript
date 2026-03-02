#include <regex.h>
#include <stdlib.h>
#include <string.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);

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

char *cs_regex_exec_dyn(void *preg, const char *str, int max_groups) {
    regex_t *regex = (regex_t *)preg;
    int total = (int)regex->re_nsub + 1;
    if (total > max_groups) total = max_groups;

    regmatch_t *pmatch = (regmatch_t *)calloc((size_t)total, sizeof(regmatch_t));
    if (!pmatch) return NULL;

    if (regexec(regex, str, (size_t)total, pmatch, 0) != 0) {
        free(pmatch);
        return NULL;
    }

    char **strings = (char **)GC_malloc((size_t)total * sizeof(char *));
    for (int i = 0; i < total; i++) {
        if (pmatch[i].rm_so >= 0) {
            int slen = pmatch[i].rm_eo - pmatch[i].rm_so;
            char *s = (char *)GC_malloc_atomic((size_t)(slen + 1));
            if (slen > 0) strncpy(s, str + pmatch[i].rm_so, (size_t)slen);
            s[slen] = '\0';
            strings[i] = s;
        } else {
            char *s = (char *)GC_malloc_atomic(1);
            s[0] = '\0';
            strings[i] = s;
        }
    }
    free(pmatch);

    char *arr = (char *)GC_malloc(16);
    *((char ***)arr) = strings;
    *((int *)(arr + 8)) = total;
    *((int *)(arr + 12)) = total;
    return arr;
}
