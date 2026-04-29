#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/stat.h>
#include <errno.h>

typedef struct { char **data; int32_t length; int32_t capacity; } CS2StrArray;

extern CS2StrArray *cs2_str_array_new(int32_t capacity);
extern void cs2_str_array_push(CS2StrArray *arr, const char *s);

const char *cs2_os_getcwd(void) {
    char buf[4096];
    if (getcwd(buf, sizeof(buf))) {
        char *r = malloc(strlen(buf) + 1);
        strcpy(r, buf);
        return r;
    }
    return "";
}

int32_t cs2_os_path_exists(const char *path) {
    struct stat st;
    return stat(path, &st) == 0 ? 1 : 0;
}

int32_t cs2_os_path_isfile(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) return 0;
    return S_ISREG(st.st_mode) ? 1 : 0;
}

int32_t cs2_os_path_isdir(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) return 0;
    return S_ISDIR(st.st_mode) ? 1 : 0;
}

const char *cs2_os_path_join(const char *a, const char *b) {
    size_t la = strlen(a);
    size_t lb = strlen(b);
    int needs_sep = la > 0 && a[la - 1] != '/';
    char *r = malloc(la + lb + 2);
    memcpy(r, a, la);
    if (needs_sep) r[la++] = '/';
    memcpy(r + la, b, lb + 1);
    return r;
}

const char *cs2_os_path_basename(const char *path) {
    const char *s = strrchr(path, '/');
    if (!s) return path;
    return s + 1;
}

const char *cs2_os_path_dirname(const char *path) {
    const char *s = strrchr(path, '/');
    if (!s) return ".";
    if (s == path) return "/";
    size_t len = s - path;
    char *r = malloc(len + 1);
    memcpy(r, path, len);
    r[len] = '\0';
    return r;
}

const char *cs2_os_path_abspath(const char *path) {
    char buf[4096];
    if (realpath(path, buf)) {
        char *r = malloc(strlen(buf) + 1);
        strcpy(r, buf);
        return r;
    }
    return path;
}

const char *cs2_os_path_splitext_name(const char *path) {
    const char *dot = strrchr(path, '.');
    const char *slash = strrchr(path, '/');
    if (!dot || (slash && dot < slash)) {
        char *r = malloc(strlen(path) + 1);
        strcpy(r, path);
        return r;
    }
    size_t len = dot - path;
    char *r = malloc(len + 1);
    memcpy(r, path, len);
    r[len] = '\0';
    return r;
}

const char *cs2_os_path_splitext_ext(const char *path) {
    const char *dot = strrchr(path, '.');
    const char *slash = strrchr(path, '/');
    if (!dot || (slash && dot < slash)) return "";
    return dot;
}

CS2StrArray *cs2_os_listdir(const char *path) {
    CS2StrArray *arr = cs2_str_array_new(16);
    DIR *d = opendir(path);
    if (!d) return arr;
    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
        cs2_str_array_push(arr, ent->d_name);
    }
    closedir(d);
    return arr;
}

const char *cs2_os_getenv(const char *name) {
    const char *v = getenv(name);
    return v ? v : "";
}

int32_t cs2_os_mkdir(const char *path) {
    return mkdir(path, 0755) == 0 ? 1 : 0;
}

int32_t cs2_os_remove(const char *path) {
    return remove(path) == 0 ? 1 : 0;
}
