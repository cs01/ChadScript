#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

char *cs2_path_join(const char *a, const char *b) {
  if (!a || !*a) return strdup(b ? b : "");
  if (!b || !*b) return strdup(a);
  int alen = strlen(a);
  int blen = strlen(b);
  int need_sep = (a[alen - 1] != '/');
  char *result = (char *)malloc(alen + blen + 2);
  strcpy(result, a);
  if (need_sep) strcat(result, "/");
  strcat(result, b);
  int rlen = strlen(result);
  while (rlen > 1 && result[rlen - 1] == '/') result[--rlen] = '\0';
  return result;
}

char *cs2_path_resolve(const char *p) {
  if (!p || !*p) {
    char *buf = (char *)malloc(PATH_MAX);
    getcwd(buf, PATH_MAX);
    return buf;
  }
  if (p[0] == '/') return strdup(p);
  char cwd[PATH_MAX];
  getcwd(cwd, PATH_MAX);
  int clen = strlen(cwd);
  int plen = strlen(p);
  char *result = (char *)malloc(clen + plen + 2);
  sprintf(result, "%s/%s", cwd, p);
  char *resolved = realpath(result, NULL);
  if (resolved) {
    free(result);
    return resolved;
  }
  return result;
}

char *cs2_path_dirname(const char *p) {
  if (!p || !*p) return strdup(".");
  char *copy = strdup(p);
  int len = strlen(copy);
  while (len > 1 && copy[len - 1] == '/') copy[--len] = '\0';
  char *last = strrchr(copy, '/');
  if (!last) { free(copy); return strdup("."); }
  if (last == copy) { free(copy); return strdup("/"); }
  *last = '\0';
  char *result = strdup(copy);
  free(copy);
  return result;
}

char *cs2_path_basename(const char *p) {
  if (!p || !*p) return strdup("");
  int len = strlen(p);
  while (len > 1 && p[len - 1] == '/') len--;
  int i = len - 1;
  while (i >= 0 && p[i] != '/') i--;
  int slen = len - i - 1;
  char *result = (char *)malloc(slen + 1);
  memcpy(result, p + i + 1, slen);
  result[slen] = '\0';
  return result;
}

char *cs2_path_extname(const char *p) {
  if (!p || !*p) return strdup("");
  const char *base = p;
  const char *last_slash = strrchr(p, '/');
  if (last_slash) base = last_slash + 1;
  const char *dot = strrchr(base, '.');
  if (!dot || dot == base) return strdup("");
  return strdup(dot);
}
