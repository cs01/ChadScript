// Regex bridge — backed by Rust's `regex` crate via the `rure` C ABI.
// Replaces the original POSIX <regex.h> implementation. Same exported
// symbols so the codegen layer in src/codegen/types/objects/regex.ts
// does not need to change.
//
// Flag wire format (legacy POSIX-shaped, kept for codegen compat):
//   bit 0 (1):    REG_EXTENDED  → ignored (rure is always extended)
//   bit 1 (2):    REG_ICASE     → RURE_FLAG_CASEI
//   bit 2 (4) OR
//   bit 3 (8):    REG_NEWLINE   → RURE_FLAG_MULTI
//                                 (Linux libc uses 4, macOS uses 8;
//                                  accept either so codegen stays
//                                  platform-agnostic in the bridge.)

#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

extern void *GC_malloc(size_t);
extern void *GC_malloc_atomic(size_t);

// rure C ABI (subset we use). Forward-declared to avoid pulling
// vendor/rure/rure.h into the translation unit; symbols are resolved
// at link time against librure.a.
typedef struct rure rure;
typedef struct rure_options rure_options;
typedef struct rure_match { size_t start; size_t end; } rure_match;
typedef struct rure_captures rure_captures;
typedef struct rure_error rure_error;

#define RURE_FLAG_CASEI         (1u << 0)
#define RURE_FLAG_MULTI         (1u << 1)
#define RURE_FLAG_DOTNL         (1u << 2)
#define RURE_FLAG_SWAP_GREED    (1u << 3)
#define RURE_FLAG_SPACE         (1u << 4)
#define RURE_FLAG_UNICODE       (1u << 5)
#define RURE_DEFAULT_FLAGS      RURE_FLAG_UNICODE

extern rure *rure_compile(const uint8_t *pattern, size_t length,
                          uint32_t flags, rure_options *options,
                          rure_error *error);
extern void rure_free(rure *re);
extern bool rure_is_match(rure *re, const uint8_t *haystack, size_t length,
                          size_t start);
extern bool rure_find_captures(rure *re, const uint8_t *haystack, size_t length,
                               size_t start, rure_captures *captures);
extern rure_captures *rure_captures_new(rure *re);
extern void rure_captures_free(rure_captures *captures);
extern bool rure_captures_at(rure_captures *captures, size_t i, rure_match *match);
extern size_t rure_captures_len(rure_captures *captures);

// Holder so the (alloc → compile) two-step from the codegen layer still
// works. rure has no allocate-then-fill API; we defer the real compile
// until cs_regex_compile is called.
typedef struct {
    rure *re;
} cs_regex_holder;

// Match shape kept binary-compatible with the old POSIX `regmatch_t`:
// two longs (start, end), -1 for "no match" / "empty group". Codegen
// reads .start via cs_pmatch_start and .end via cs_pmatch_end.
typedef struct {
    long long start;
    long long end;
} cs_pmatch_entry;

void *cs_regex_alloc(void) {
    cs_regex_holder *h = (cs_regex_holder *)malloc(sizeof(cs_regex_holder));
    if (h) h->re = NULL;
    return h;
}

static uint32_t translate_cflags(int cflags) {
    uint32_t flags = RURE_DEFAULT_FLAGS;  // unicode on by default, like JS
    if (cflags & 0x2) flags |= RURE_FLAG_CASEI;          // REG_ICASE
    if (cflags & (0x4 | 0x8)) flags |= RURE_FLAG_MULTI;  // REG_NEWLINE (linux=4, macos=8)
    return flags;
}

int cs_regex_compile(void *preg, const char *pattern, int cflags) {
    cs_regex_holder *h = (cs_regex_holder *)preg;
    if (!h) return -1;
    uint32_t flags = translate_cflags(cflags);
    h->re = rure_compile((const uint8_t *)pattern, strlen(pattern),
                         flags, NULL, NULL);
    return h->re ? 0 : -1;
}

void cs_regex_free(void *preg) {
    if (!preg) return;
    cs_regex_holder *h = (cs_regex_holder *)preg;
    if (h->re) rure_free(h->re);
    free(h);
}

void *cs_pmatch_alloc(int ngroups) {
    if (ngroups < 1) ngroups = 1;
    return calloc((size_t)ngroups, sizeof(cs_pmatch_entry));
}

// Returns 0 on match (POSIX REG_OK convention), nonzero on no-match.
int cs_regex_exec(void *preg, const char *str, int ngroups, void *pmatch, int eflags) {
    (void)eflags;
    cs_regex_holder *h = (cs_regex_holder *)preg;
    if (!h || !h->re) return -1;

    size_t slen = strlen(str);
    cs_pmatch_entry *out = (cs_pmatch_entry *)pmatch;

    if (ngroups <= 0 || pmatch == NULL) {
        // Test-only fast path (REG_NOSUB-equivalent).
        return rure_is_match(h->re, (const uint8_t *)str, slen, 0) ? 0 : 1;
    }

    rure_captures *caps = rure_captures_new(h->re);
    if (!caps) return -1;
    bool matched = rure_find_captures(h->re, (const uint8_t *)str, slen, 0, caps);
    if (!matched) { rure_captures_free(caps); return 1; }

    size_t total = rure_captures_len(caps);
    if (total > (size_t)ngroups) total = (size_t)ngroups;
    for (size_t i = 0; i < total; i++) {
        rure_match m;
        if (rure_captures_at(caps, i, &m)) {
            out[i].start = (long long)m.start;
            out[i].end   = (long long)m.end;
        } else {
            out[i].start = -1;
            out[i].end   = -1;
        }
    }
    for (size_t i = total; i < (size_t)ngroups; i++) {
        out[i].start = -1;
        out[i].end   = -1;
    }
    rure_captures_free(caps);
    return 0;
}

long long cs_pmatch_start(void *pmatch, int idx) {
    return ((cs_pmatch_entry *)pmatch)[idx].start;
}

long long cs_pmatch_end(void *pmatch, int idx) {
    return ((cs_pmatch_entry *)pmatch)[idx].end;
}

// Returns a chad-shape `string[]` array holding each capture group's
// matched substring (group 0 = full match). NULL on no-match.
//
// In-memory ABI for chad's `string[]`:
//   { char **data; int len; int cap; }   (16 bytes on 64-bit)
char *cs_regex_exec_dyn(void *preg, const char *str, int max_groups) {
    cs_regex_holder *h = (cs_regex_holder *)preg;
    if (!h || !h->re || max_groups < 1) return NULL;

    size_t slen = strlen(str);
    rure_captures *caps = rure_captures_new(h->re);
    if (!caps) return NULL;
    bool matched = rure_find_captures(h->re, (const uint8_t *)str, slen, 0, caps);
    if (!matched) { rure_captures_free(caps); return NULL; }

    size_t total = rure_captures_len(caps);
    if (total > (size_t)max_groups) total = (size_t)max_groups;

    char **strings = (char **)GC_malloc(total * sizeof(char *));
    for (size_t i = 0; i < total; i++) {
        rure_match m;
        bool got = rure_captures_at(caps, i, &m);
        if (!got) {
            char *s = (char *)GC_malloc_atomic(1);
            s[0] = '\0';
            strings[i] = s;
            continue;
        }
        size_t glen = m.end - m.start;
        char *s = (char *)GC_malloc_atomic(glen + 1);
        if (glen > 0) memcpy(s, str + m.start, glen);
        s[glen] = '\0';
        strings[i] = s;
    }
    rure_captures_free(caps);

    char *arr = (char *)GC_malloc(16);
    *((char ***)arr)         = strings;
    *((int *)(arr + 8))      = (int)total;
    *((int *)(arr + 12))     = (int)total;
    return arr;
}
