/**
 * Multipart form-data parser for ChadScript HTTP servers.
 *
 * Parses RFC 2046 multipart/form-data bodies into individual parts.
 * Each part has a name, optional filename, content-type, data pointer,
 * and data length. Uses GC_malloc for all allocations so results are
 * garbage-collected.
 */

#include <stdint.h>
#include <string.h>
#include <stdlib.h>

extern void *GC_malloc(size_t size);
extern void *GC_malloc_atomic(size_t size);

typedef struct {
    const char *name;         /* field name from Content-Disposition */
    const char *filename;     /* original filename, or NULL if not a file */
    const char *content_type; /* part Content-Type, or "application/octet-stream" */
    const char *data;         /* part body (may contain \0) */
    int64_t data_len;         /* part body length */
} cs_multipart_part;

/**
 * Extract a quoted or unquoted parameter value from a header line.
 * e.g. from 'Content-Disposition: form-data; name="file"' extracts "file".
 * Returns GC-allocated copy of the value, or NULL if not found.
 */
static const char *extract_param(const char *header, int header_len,
                                  const char *param) {
    int param_len = (int)strlen(param);
    const char *end = header + header_len;
    const char *p = header;

    while (p < end - param_len) {
        if (memcmp(p, param, param_len) == 0) {
            p += param_len;
            if (p < end && *p == '=') {
                p++;
                if (p < end && *p == '"') {
                    /* quoted value */
                    p++;
                    const char *start = p;
                    while (p < end && *p != '"') p++;
                    int len = (int)(p - start);
                    char *val = (char *)GC_malloc_atomic(len + 1);
                    memcpy(val, start, len);
                    val[len] = '\0';
                    return val;
                } else {
                    /* unquoted value — ends at ; or end of header */
                    const char *start = p;
                    while (p < end && *p != ';' && *p != '\r' && *p != '\n') p++;
                    int len = (int)(p - start);
                    char *val = (char *)GC_malloc_atomic(len + 1);
                    memcpy(val, start, len);
                    val[len] = '\0';
                    return val;
                }
            }
        }
        p++;
    }
    return NULL;
}

/**
 * Find a boundary occurrence in binary data. Binary-safe (uses memcmp).
 * Returns pointer to the start of the boundary, or NULL if not found.
 */
static const char *find_boundary(const char *data, int64_t data_len,
                                  const char *boundary, int boundary_len) {
    if (data_len < boundary_len) return NULL;
    int64_t limit = data_len - boundary_len;
    for (int64_t i = 0; i <= limit; i++) {
        if (memcmp(data + i, boundary, boundary_len) == 0) {
            return data + i;
        }
    }
    return NULL;
}

/**
 * Parse a multipart/form-data body into individual parts.
 *
 * @param content_type  Full Content-Type header value (e.g. "multipart/form-data; boundary=----abc")
 * @param body          Raw request body (may contain \0)
 * @param body_len      Byte length of body
 * @param out_count     Output: number of parts found
 * @return              GC-allocated array of cs_multipart_part, or NULL on error
 */
cs_multipart_part *cs_parse_multipart(const char *content_type,
                                       const char *body,
                                       int64_t body_len,
                                       int *out_count) {
    *out_count = 0;

    if (!content_type || !body || body_len <= 0) return NULL;

    /* Extract boundary from content_type */
    const char *bp = strstr(content_type, "boundary=");
    if (!bp) return NULL;
    bp += 9; /* skip "boundary=" */

    /* Handle quoted boundary */
    const char *bstart;
    int blen;
    if (*bp == '"') {
        bp++;
        bstart = bp;
        while (*bp && *bp != '"') bp++;
        blen = (int)(bp - bstart);
    } else {
        bstart = bp;
        while (*bp && *bp != ';' && *bp != ' ' && *bp != '\r' && *bp != '\n') bp++;
        blen = (int)(bp - bstart);
    }
    if (blen == 0) return NULL;

    /* Build the full delimiter: "--" + boundary */
    int delim_len = 2 + blen;
    char *delim = (char *)alloca(delim_len + 1);
    delim[0] = '-';
    delim[1] = '-';
    memcpy(delim + 2, bstart, blen);
    delim[delim_len] = '\0';

    /* First pass: count parts */
    int count = 0;
    const char *pos = body;
    int64_t remaining = body_len;

    /* Find first boundary */
    pos = find_boundary(pos, remaining, delim, delim_len);
    if (!pos) return NULL;

    while (pos) {
        /* Skip past boundary + CRLF */
        pos += delim_len;
        remaining = body_len - (int64_t)(pos - body);
        if (remaining < 2) break;

        /* Check for closing "--" */
        if (pos[0] == '-' && pos[1] == '-') break;

        /* Skip CRLF after boundary */
        if (pos[0] == '\r' && pos[1] == '\n') {
            pos += 2;
            remaining -= 2;
        } else if (pos[0] == '\n') {
            pos += 1;
            remaining -= 1;
        }

        count++;

        /* Find next boundary */
        const char *next = find_boundary(pos, remaining, delim, delim_len);
        if (!next) break;
        pos = next;
        remaining = body_len - (int64_t)(pos - body);
    }

    if (count == 0) return NULL;

    /* Allocate result array */
    cs_multipart_part *parts = (cs_multipart_part *)GC_malloc(
        sizeof(cs_multipart_part) * count);

    /* Second pass: extract parts */
    pos = body;
    remaining = body_len;
    pos = find_boundary(pos, remaining, delim, delim_len);
    int idx = 0;

    while (pos && idx < count) {
        pos += delim_len;
        remaining = body_len - (int64_t)(pos - body);
        if (remaining < 2) break;
        if (pos[0] == '-' && pos[1] == '-') break;

        /* Skip CRLF */
        if (pos[0] == '\r' && pos[1] == '\n') {
            pos += 2;
            remaining -= 2;
        } else if (pos[0] == '\n') {
            pos += 1;
            remaining -= 1;
        }

        /* Parse headers until blank line (CRLFCRLF or LFLF) */
        const char *headers_start = pos;
        const char *body_start = NULL;

        /* Find end of headers: \r\n\r\n or \n\n */
        for (int64_t i = 0; i < remaining - 1; i++) {
            if (pos[i] == '\r' && i + 3 < remaining &&
                pos[i+1] == '\n' && pos[i+2] == '\r' && pos[i+3] == '\n') {
                body_start = pos + i + 4;
                break;
            }
            if (pos[i] == '\n' && pos[i+1] == '\n') {
                body_start = pos + i + 2;
                break;
            }
        }
        if (!body_start) break;

        int headers_len = (int)(body_start - headers_start);

        /* Find next boundary to determine part body end */
        int64_t body_remaining = body_len - (int64_t)(body_start - body);
        const char *next_boundary = find_boundary(body_start, body_remaining,
                                                   delim, delim_len);
        int64_t part_body_len;
        if (next_boundary) {
            part_body_len = (int64_t)(next_boundary - body_start);
            /* Trim trailing CRLF before boundary */
            if (part_body_len >= 2 &&
                body_start[part_body_len - 2] == '\r' &&
                body_start[part_body_len - 1] == '\n') {
                part_body_len -= 2;
            } else if (part_body_len >= 1 &&
                       body_start[part_body_len - 1] == '\n') {
                part_body_len -= 1;
            }
        } else {
            part_body_len = body_remaining;
        }

        /* Extract header values */
        const char *name = extract_param(headers_start, headers_len, "name");
        const char *filename = extract_param(headers_start, headers_len, "filename");

        /* Extract Content-Type from part headers */
        const char *ct = "application/octet-stream";
        const char *ct_marker = "Content-Type:";
        int ct_marker_len = 13;
        for (const char *hp = headers_start; hp < body_start - ct_marker_len; hp++) {
            if ((*hp == 'C' || *hp == 'c') &&
                strncasecmp(hp, ct_marker, ct_marker_len) == 0) {
                hp += ct_marker_len;
                while (hp < body_start && (*hp == ' ' || *hp == '\t')) hp++;
                const char *ct_start = hp;
                while (hp < body_start && *hp != '\r' && *hp != '\n') hp++;
                int ct_len = (int)(hp - ct_start);
                char *ct_val = (char *)GC_malloc_atomic(ct_len + 1);
                memcpy(ct_val, ct_start, ct_len);
                ct_val[ct_len] = '\0';
                ct = ct_val;
                break;
            }
        }

        /* Copy part body to GC-allocated buffer */
        char *part_data = (char *)GC_malloc_atomic(part_body_len + 1);
        memcpy(part_data, body_start, part_body_len);
        part_data[part_body_len] = '\0';

        parts[idx].name = name ? name : "";
        parts[idx].filename = filename;
        parts[idx].content_type = ct;
        parts[idx].data = part_data;
        parts[idx].data_len = part_body_len;
        idx++;

        pos = next_boundary;
        if (!pos) break;
        remaining = body_len - (int64_t)(pos - body);
    }

    *out_count = idx;
    return parts;
}

/**
 * ChadScript-compatible wrapper: returns an ObjectArray of interface structs.
 *
 * ChadScript ObjectArray: { i8** data, i32 length, i32 capacity }
 * Each element is an i8* pointing to a MultipartPart interface struct:
 *   { i8* name, i8* filename, i8* contentType, i8* data, double dataLen }
 *
 * The double dataLen allows ChadScript code to get the binary-safe length
 * of the data field (since ChadScript numbers are doubles).
 */
typedef struct {
    const char *name;
    const char *filename;
    const char *content_type;
    const char *data;
    double data_len;
} cs_multipart_part_cs;

typedef struct {
    void **data;
    int32_t length;
    int32_t capacity;
} cs_object_array;

cs_object_array *cs_parse_multipart_to_array(const char *content_type,
                                              const char *body,
                                              int64_t body_len) {
    int count = 0;
    cs_multipart_part *parts = cs_parse_multipart(content_type, body,
                                                   body_len, &count);

    /* Allocate the ObjectArray struct */
    cs_object_array *arr = (cs_object_array *)GC_malloc(sizeof(cs_object_array));
    arr->length = count;
    arr->capacity = count;

    if (count == 0 || !parts) {
        arr->data = NULL;
        return arr;
    }

    /* Allocate the pointer array */
    arr->data = (void **)GC_malloc(sizeof(void *) * count);

    /* Convert each part to a ChadScript-compatible interface struct */
    for (int i = 0; i < count; i++) {
        cs_multipart_part_cs *cs_part =
            (cs_multipart_part_cs *)GC_malloc(sizeof(cs_multipart_part_cs));
        cs_part->name = parts[i].name;
        cs_part->filename = parts[i].filename ? parts[i].filename : "";
        cs_part->content_type = parts[i].content_type;
        cs_part->data = parts[i].data;
        cs_part->data_len = (double)parts[i].data_len;
        arr->data[i] = (void *)cs_part;
    }

    return arr;
}
