#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>

struct curl_slist* cs_curl_set_headers(CURL *curl, const char *headers_str) {
    struct curl_slist *slist = NULL;
    if (!headers_str || headers_str[0] == '\0') return NULL;

    const char *p = headers_str;
    while (*p) {
        const char *end = strchr(p, '\n');
        if (!end) end = p + strlen(p);
        size_t len = end - p;
        if (len > 0) {
            char *line = (char *)malloc(len + 1);
            memcpy(line, p, len);
            line[len] = '\0';
            if (line[len - 1] == '\r') line[len - 1] = '\0';
            if (line[0] != '\0') {
                slist = curl_slist_append(slist, line);
            }
            free(line);
        }
        p = *end ? end + 1 : end;
    }

    if (slist) {
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, slist);
    }
    return slist;
}
