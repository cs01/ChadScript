#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *cs2_exec_sync(const char *command) {
  FILE *fp = popen(command, "r");
  if (!fp) return strdup("");
  size_t capacity = 1024;
  size_t length = 0;
  char *buf = (char *)malloc(capacity);
  char chunk[512];
  while (fgets(chunk, sizeof(chunk), fp) != NULL) {
    size_t chunk_len = strlen(chunk);
    if (length + chunk_len + 1 > capacity) {
      capacity = (length + chunk_len + 1) * 2;
      buf = (char *)realloc(buf, capacity);
    }
    memcpy(buf + length, chunk, chunk_len);
    length += chunk_len;
  }
  buf[length] = '\0';
  pclose(fp);
  return buf;
}
