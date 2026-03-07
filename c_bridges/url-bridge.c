#include <string.h>
#include <stdlib.h>
#include <stdio.h>

extern void* GC_malloc_atomic(size_t sz);
extern void* GC_malloc(size_t sz);

static char* cs_strdup_gc(const char* s) {
    if (!s) return NULL;
    size_t len = strlen(s);
    char* out = (char*)GC_malloc_atomic(len + 1);
    memcpy(out, s, len + 1);
    return out;
}

static char* cs_strndup_gc(const char* s, size_t n) {
    char* out = (char*)GC_malloc_atomic(n + 1);
    memcpy(out, s, n);
    out[n] = '\0';
    return out;
}

const char* cs_url_parse_protocol(const char* href) {
    if (!href) return cs_strdup_gc("");
    const char* colon = strstr(href, "://");
    if (!colon) return cs_strdup_gc("");
    size_t len = colon - href + 1;
    char* out = (char*)GC_malloc_atomic(len + 1);
    memcpy(out, href, len);
    out[len] = '\0';
    return out;
}

const char* cs_url_parse_hostname(const char* href) {
    if (!href) return cs_strdup_gc("");
    const char* after = strstr(href, "://");
    if (!after) return cs_strdup_gc("");
    after += 3;
    const char* end = after;
    while (*end && *end != '/' && *end != '?' && *end != '#' && *end != ':') end++;
    return cs_strndup_gc(after, end - after);
}

const char* cs_url_parse_port(const char* href) {
    if (!href) return cs_strdup_gc("");
    const char* after = strstr(href, "://");
    if (!after) return cs_strdup_gc("");
    after += 3;
    const char* colon = NULL;
    const char* p = after;
    while (*p && *p != '/' && *p != '?' && *p != '#') {
        if (*p == ':') { colon = p; break; }
        p++;
    }
    if (!colon) return cs_strdup_gc("");
    colon++;
    const char* end = colon;
    while (*end && *end != '/' && *end != '?' && *end != '#') end++;
    return cs_strndup_gc(colon, end - colon);
}

const char* cs_url_parse_host(const char* href) {
    if (!href) return cs_strdup_gc("");
    const char* after = strstr(href, "://");
    if (!after) return cs_strdup_gc("");
    after += 3;
    const char* end = after;
    while (*end && *end != '/' && *end != '?' && *end != '#') end++;
    return cs_strndup_gc(after, end - after);
}

const char* cs_url_parse_pathname(const char* href) {
    if (!href) return cs_strdup_gc("/");
    const char* after = strstr(href, "://");
    if (!after) return cs_strdup_gc("/");
    after += 3;
    while (*after && *after != '/' && *after != '?' && *after != '#') after++;
    if (!*after || *after == '?' || *after == '#') return cs_strdup_gc("/");
    const char* end = after;
    while (*end && *end != '?' && *end != '#') end++;
    return cs_strndup_gc(after, end - after);
}

const char* cs_url_parse_search(const char* href) {
    if (!href) return cs_strdup_gc("");
    const char* q = strchr(href, '?');
    if (!q) return cs_strdup_gc("");
    const char* end = q;
    while (*end && *end != '#') end++;
    return cs_strndup_gc(q, end - q);
}

const char* cs_url_parse_hash(const char* href) {
    if (!href) return cs_strdup_gc("");
    const char* h = strchr(href, '#');
    if (!h) return cs_strdup_gc("");
    return cs_strdup_gc(h);
}

const char* cs_url_parse_origin(const char* href) {
    if (!href) return cs_strdup_gc("");
    const char* after = strstr(href, "://");
    if (!after) return cs_strdup_gc("");
    after += 3;
    const char* end = after;
    while (*end && *end != '/' && *end != '?' && *end != '#') end++;
    size_t proto_len = (after - 3) - href;
    size_t host_len = end - after;
    size_t total = proto_len + 3 + host_len;
    char* out = (char*)GC_malloc_atomic(total + 1);
    memcpy(out, href, proto_len + 3 + host_len);
    out[total] = '\0';
    return out;
}

static const char* skip_qmark(const char* q) {
    if (q && *q == '?') return q + 1;
    return q ? q : "";
}

const char* cs_urlsearch_get(const char* query, const char* key) {
    if (!query || !key) return NULL;
    const char* q = skip_qmark(query);
    size_t klen = strlen(key);
    const char* p = q;
    while (*p) {
        const char* eq = strchr(p, '=');
        if (!eq) break;
        size_t nlen = eq - p;
        if (nlen == klen && strncmp(p, key, klen) == 0) {
            eq++;
            const char* vend = strchr(eq, '&');
            if (!vend) vend = eq + strlen(eq);
            return cs_strndup_gc(eq, vend - eq);
        }
        const char* amp = strchr(eq, '&');
        if (!amp) break;
        p = amp + 1;
    }
    return NULL;
}

int cs_urlsearch_has(const char* query, const char* key) {
    if (!query || !key) return 0;
    const char* q = skip_qmark(query);
    size_t klen = strlen(key);
    const char* p = q;
    while (*p) {
        const char* eq = strchr(p, '=');
        if (!eq) {
            if (strlen(p) == klen && strncmp(p, key, klen) == 0) return 1;
            break;
        }
        size_t nlen = eq - p;
        if (nlen == klen && strncmp(p, key, klen) == 0) return 1;
        const char* amp = strchr(eq, '&');
        if (!amp) break;
        p = amp + 1;
    }
    return 0;
}

const char* cs_urlsearch_set(const char* query, const char* key, const char* value) {
    if (!key || !value) return query ? cs_strdup_gc(query) : cs_strdup_gc("");
    const char* q = skip_qmark(query ? query : "");
    size_t klen = strlen(key);
    size_t buf_size = strlen(q) + strlen(key) + strlen(value) + 64;
    char* out = (char*)GC_malloc_atomic(buf_size);
    out[0] = '\0';
    int found = 0;
    const char* p = q;
    int first = 1;
    while (*p) {
        const char* eq = strchr(p, '=');
        if (!eq) break;
        size_t nlen = eq - p;
        const char* amp = strchr(eq, '&');
        const char* seg_end = amp ? amp : eq + strlen(eq);
        if (!first) strcat(out, "&");
        first = 0;
        if (nlen == klen && strncmp(p, key, klen) == 0) {
            strncat(out, key, klen);
            strcat(out, "=");
            strcat(out, value);
            found = 1;
        } else {
            strncat(out, p, seg_end - p);
        }
        if (!amp) break;
        p = amp + 1;
    }
    if (!found) {
        if (!first) strcat(out, "&");
        strcat(out, key);
        strcat(out, "=");
        strcat(out, value);
    }
    return out;
}

const char* cs_urlsearch_append(const char* query, const char* key, const char* value) {
    if (!key || !value) return query ? cs_strdup_gc(query) : cs_strdup_gc("");
    const char* q = skip_qmark(query ? query : "");
    size_t qlen = strlen(q);
    size_t klen = strlen(key);
    size_t vlen = strlen(value);
    size_t total = qlen + klen + vlen + 4;
    char* out = (char*)GC_malloc_atomic(total);
    if (qlen > 0) {
        memcpy(out, q, qlen);
        out[qlen] = '&';
        memcpy(out + qlen + 1, key, klen);
        out[qlen + 1 + klen] = '=';
        memcpy(out + qlen + 1 + klen + 1, value, vlen);
        out[qlen + 1 + klen + 1 + vlen] = '\0';
    } else {
        memcpy(out, key, klen);
        out[klen] = '=';
        memcpy(out + klen + 1, value, vlen);
        out[klen + 1 + vlen] = '\0';
    }
    return out;
}

const char* cs_urlsearch_delete(const char* query, const char* key) {
    if (!query || !key) return cs_strdup_gc("");
    const char* q = skip_qmark(query);
    size_t klen = strlen(key);
    size_t buf_size = strlen(q) + 2;
    char* out = (char*)GC_malloc_atomic(buf_size);
    out[0] = '\0';
    const char* p = q;
    int first = 1;
    while (*p) {
        const char* eq = strchr(p, '=');
        if (!eq) break;
        size_t nlen = eq - p;
        const char* amp = strchr(eq, '&');
        const char* seg_end = amp ? amp : eq + strlen(eq);
        if (!(nlen == klen && strncmp(p, key, klen) == 0)) {
            if (!first) strcat(out, "&");
            first = 0;
            strncat(out, p, seg_end - p);
        }
        if (!amp) break;
        p = amp + 1;
    }
    return out;
}

const char* cs_urlsearch_tostring(const char* query) {
    if (!query) return cs_strdup_gc("");
    return cs_strdup_gc(skip_qmark(query));
}
