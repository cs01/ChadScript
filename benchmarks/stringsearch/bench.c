#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <dirent.h>
#include <sys/stat.h>

#define NEEDLE "console.log"
#define SEARCH_DIR "src"

static int total_matches = 0;

static void search_file(const char *path) {
    FILE *f = fopen(path, "r");
    if (!f) return;

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size == 0) { fclose(f); return; }

    char *buf = (char *)malloc(size + 1);
    fread(buf, 1, size, f);
    buf[size] = '\0';
    fclose(f);

    char *line = buf;
    while (line && *line) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = '\0';
        if (strstr(line, NEEDLE)) {
            total_matches++;
        }
        if (nl) {
            line = nl + 1;
        } else {
            break;
        }
    }
    free(buf);
}

static void search_dir(const char *path) {
    DIR *d = opendir(path);
    if (!d) return;

    struct dirent *ent;
    char fullpath[4096];
    struct stat st;

    while ((ent = readdir(d)) != NULL) {
        if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0)
            continue;
        snprintf(fullpath, sizeof(fullpath), "%s/%s", path, ent->d_name);
        if (stat(fullpath, &st) != 0) continue;
        if (S_ISREG(st.st_mode)) {
            search_file(fullpath);
        } else if (S_ISDIR(st.st_mode)) {
            search_dir(fullpath);
        }
    }
    closedir(d);
}

int main(void) {
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    search_dir(SEARCH_DIR);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double elapsed = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

    printf("Matches:  %d\n", total_matches);
    printf("Time:     %.3fs\n", elapsed);

    return 0;
}
