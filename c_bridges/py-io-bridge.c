#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

typedef struct { char **data; int32_t length; int32_t capacity; } CS2StrArray;
extern CS2StrArray *cs2_str_array_new(int32_t capacity);
extern void cs2_str_array_push(CS2StrArray *arr, const char *s);

FILE *cs2_io_open(const char *path, const char *mode) {
    return fopen(path, mode);
}

int32_t cs2_io_close(FILE *f) {
    if (!f) return 0;
    return fclose(f) == 0 ? 1 : 0;
}

const char *cs2_io_read(FILE *f) {
    if (!f) return "";
    long start = ftell(f);
    fseek(f, 0, SEEK_END);
    long end = ftell(f);
    fseek(f, start, SEEK_SET);
    long size = end - start;
    if (size <= 0) return "";
    char *buf = malloc(size + 1);
    size_t n = fread(buf, 1, size, f);
    buf[n] = '\0';
    return buf;
}

const char *cs2_io_readline(FILE *f) {
    if (!f) return "";
    size_t cap = 256;
    char *buf = malloc(cap);
    size_t len = 0;
    int c;
    while ((c = fgetc(f)) != EOF) {
        if (len + 1 >= cap) { cap *= 2; buf = realloc(buf, cap); }
        buf[len++] = (char)c;
        if (c == '\n') break;
    }
    if (len == 0 && c == EOF) { free(buf); return ""; }
    buf[len] = '\0';
    return buf;
}

CS2StrArray *cs2_io_readlines(FILE *f) {
    CS2StrArray *arr = cs2_str_array_new(16);
    if (!f) return arr;
    size_t cap = 256;
    char *buf = malloc(cap);
    size_t len = 0;
    int c;
    while ((c = fgetc(f)) != EOF) {
        if (len + 1 >= cap) { cap *= 2; buf = realloc(buf, cap); }
        buf[len++] = (char)c;
        if (c == '\n') {
            buf[len] = '\0';
            char *line = malloc(len + 1);
            memcpy(line, buf, len + 1);
            cs2_str_array_push(arr, line);
            len = 0;
        }
    }
    if (len > 0) {
        buf[len] = '\0';
        char *line = malloc(len + 1);
        memcpy(line, buf, len + 1);
        cs2_str_array_push(arr, line);
    }
    free(buf);
    return arr;
}

int32_t cs2_io_write(FILE *f, const char *s) {
    if (!f || !s) return 0;
    return fputs(s, f) >= 0 ? 1 : 0;
}

int32_t cs2_io_write_line(FILE *f, const char *s) {
    if (!f || !s) return 0;
    return fprintf(f, "%s\n", s) >= 0 ? 1 : 0;
}

int32_t cs2_io_is_eof(FILE *f) {
    if (!f) return 1;
    return feof(f) ? 1 : 0;
}

int64_t cs2_io_tell(FILE *f) {
    if (!f) return -1;
    return (int64_t)ftell(f);
}

int32_t cs2_io_seek(FILE *f, int64_t offset, int32_t whence) {
    if (!f) return 0;
    return fseek(f, (long)offset, (int)whence) == 0 ? 1 : 0;
}

const char *cs2_io_read_n(FILE *f, int64_t n) {
    if (!f || n <= 0) return "";
    char *buf = malloc(n + 1);
    size_t got = fread(buf, 1, (size_t)n, f);
    buf[got] = '\0';
    return buf;
}

int32_t cs2_io_flush(FILE *f) {
    if (!f) return 0;
    return fflush(f) == 0 ? 1 : 0;
}
