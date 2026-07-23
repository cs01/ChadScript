// Filesystem access. Paths and contents are UTF-8 CsString {ptr,len} like every other string, so
// nothing here relies on NUL termination — except the POSIX calls themselves, which require a
// NUL-terminated path, so a copy is made for that purpose alone.
//
// Errors follow Node: a failed read/unlink THROWS (cs_throw, so try/catch handles it), rather
// than returning a sentinel that a caller could ignore. existsSync answers false instead.

#include "strings.h"
#include <gc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// Raising through the same path a `throw new Error(...)` takes, so user try/catch handles it.
typedef struct CsThrown CsThrown;
extern CsThrown *cs_new_error(const CsString *message);
extern void cs_throw(CsThrown *value);

// A NUL-terminated copy of a CsString, for POSIX calls that demand one. An embedded NUL would
// truncate the path here — which is exactly what the OS would do with it anyway.
static char *path_cstr(const CsString *p) {
  char *buf = GC_malloc(p->len + 1);
  memcpy(buf, p->data, p->len);
  buf[p->len] = '\0';
  return buf;
}

static void throw_fs_error(const char *op, const CsString *path) {
  // Shaped like Node's message so a caught error reads the same: "ENOENT: ... 'path'".
  char msg[512];
  int n = snprintf(msg, sizeof(msg), "ENOENT: no such file or directory, %s '%.*s'", op,
                   (int)path->len, path->data);
  if (n < 0) n = 0;
  if ((size_t)n > sizeof(msg)) n = (int)sizeof(msg);
  cs_throw(cs_new_error(cs_str_from(msg, (size_t)n)));
}

// fs.readFileSync(path, "utf8") → the whole file as a string.
CsString *cs_fs_read_file(const CsString *path) {
  FILE *f = fopen(path_cstr(path), "rb");
  if (!f) {
    throw_fs_error("open", path);
    return 0; // unreachable: cs_throw does not return
  }
  if (fseek(f, 0, SEEK_END) != 0) {
    fclose(f);
    throw_fs_error("read", path);
    return 0;
  }
  long size = ftell(f);
  if (size < 0) {
    fclose(f);
    throw_fs_error("read", path);
    return 0;
  }
  rewind(f);
  char *buf = GC_malloc((size_t)size + 1);
  size_t got = size > 0 ? fread(buf, 1, (size_t)size, f) : 0;
  fclose(f);
  return cs_str_mk(buf, got);
}

// fs.writeFileSync(path, data). Truncates like Node.
void cs_fs_write_file(const CsString *path, const CsString *data) {
  FILE *f = fopen(path_cstr(path), "wb");
  if (!f) {
    throw_fs_error("open", path);
    return;
  }
  if (data->len > 0) fwrite(data->data, 1, data->len, f);
  fclose(f);
}

// fs.appendFileSync(path, data).
void cs_fs_append_file(const CsString *path, const CsString *data) {
  FILE *f = fopen(path_cstr(path), "ab");
  if (!f) {
    throw_fs_error("open", path);
    return;
  }
  if (data->len > 0) fwrite(data->data, 1, data->len, f);
  fclose(f);
}

// fs.existsSync(path) → 0/1. Never throws: absence is the answer, not an error.
int32_t cs_fs_exists(const CsString *path) { return access(path_cstr(path), F_OK) == 0 ? 1 : 0; }

// fs.unlinkSync(path).
void cs_fs_unlink(const CsString *path) {
  if (unlink(path_cstr(path)) != 0) throw_fs_error("unlink", path);
}
