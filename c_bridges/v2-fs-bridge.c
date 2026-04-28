#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef struct {
    char **data;
    int32_t length;
    int32_t capacity;
} StrArray;

StrArray *cs2_str_array_new(int32_t capacity);
void cs2_str_array_push(StrArray *arr, const char *value);

char *cs2_fs_read_file_sync(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) {
    fprintf(stderr, "Error: ENOENT: no such file or directory, open '%s'\n", path);
    exit(1);
  }
  fseek(f, 0, SEEK_END);
  long len = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *buf = (char *)malloc(len + 1);
  fread(buf, 1, len, f);
  buf[len] = '\0';
  fclose(f);
  return buf;
}

void cs2_fs_write_file_sync(const char *path, const char *data) {
  FILE *f = fopen(path, "wb");
  if (!f) {
    fprintf(stderr, "Error: ENOENT: no such file or directory, open '%s'\n", path);
    exit(1);
  }
  fwrite(data, 1, strlen(data), f);
  fclose(f);
}

int cs2_fs_exists_sync(const char *path) {
  return access(path, F_OK) == 0 ? 1 : 0;
}

StrArray *cs2_fs_readdir_sync(const char *path) {
  StrArray *arr = cs2_str_array_new(8);
  DIR *d = opendir(path);
  if (!d) {
    fprintf(stderr, "Error: ENOENT: no such file or directory, scandir '%s'\n", path);
    exit(1);
  }
  struct dirent *ent;
  while ((ent = readdir(d)) != NULL) {
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
    cs2_str_array_push(arr, strdup(ent->d_name));
  }
  closedir(d);
  return arr;
}

int cs2_fs_mkdir_sync(const char *path) {
  return mkdir(path, 0777);
}

void cs2_fs_unlink_sync(const char *path) {
  unlink(path);
}

int cs2_fs_stat_is_file(const char *path) {
  struct stat st;
  if (stat(path, &st) != 0) return 0;
  return S_ISREG(st.st_mode) ? 1 : 0;
}

int cs2_fs_stat_is_directory(const char *path) {
  struct stat st;
  if (stat(path, &st) != 0) return 0;
  return S_ISDIR(st.st_mode) ? 1 : 0;
}
