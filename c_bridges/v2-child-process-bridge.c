#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>

extern void cs2_throw(const char *msg);

char *cs2_exec_sync(const char *command) {
  FILE *fp = popen(command, "r");
  if (!fp) {
    cs2_throw("execSync: popen failed");
    return strdup("");
  }
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
  int status = pclose(fp);
  if (status != 0) {
    int code = WIFEXITED(status) ? WEXITSTATUS(status) : 1;
    char errbuf[512];
    snprintf(errbuf, sizeof(errbuf), "Command failed with exit code %d: %.400s", code, command);
    char *msg = strdup(errbuf);
    free(buf);
    cs2_throw(msg);
    return strdup("");
  }
  return buf;
}
