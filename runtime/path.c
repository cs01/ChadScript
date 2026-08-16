// `node:path` — the POSIX subset. Every function here is a byte-faithful port of Node's
// lib/path.js `posix` object, because the differential oracle IS Node: any deviation in the
// `..`/duplicate-slash/trailing-slash rules shows up as a stdout mismatch, not as a subtle bug.
//
// POSIX only. The win32 branch of Node's path is not ported and `node:path` is not re-exported
// as `path.win32`/`path.posix`, so there is no way to reach the unported half from the subset.
//
// Strings are CsString {ptr,len} like everywhere else: no strlen/strcmp, and an embedded NUL is
// an ordinary byte that flows through unharmed (Node treats it that way too — only the syscall
// boundary in fs.c truncates).

#include "strings.h"
#include <gc.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

typedef struct CsThrown CsThrown;
extern CsThrown *cs_new_error(const CsString *message);
extern void cs_throw(CsThrown *value);

// Mirrors runtime/array.c's layout. A string array's slots hold `CsString*` bit-cast to i64.
typedef struct {
  int64_t *data;
  int32_t len;
  int32_t cap;
} CsArray;

// A growable GC byte buffer. `data` is GC memory, so handing it to cs_str_mk (which wraps
// without copying) is safe: the returned header keeps the buffer reachable.
typedef struct {
  char *data;
  size_t len;
  size_t cap;
} Buf;

static Buf buf_new(void) {
  Buf b;
  b.cap = 64;
  b.data = GC_malloc_atomic(b.cap);
  b.len = 0;
  return b;
}

static void buf_append(Buf *b, const char *src, size_t n) {
  if (n == 0) return;
  if (b->len + n > b->cap) {
    size_t cap = b->cap * 2;
    while (cap < b->len + n) cap *= 2;
    char *grown = GC_malloc_atomic(cap);
    memcpy(grown, b->data, b->len);
    b->data = grown;
    b->cap = cap;
  }
  memcpy(b->data + b->len, src, n);
  b->len += n;
}

// Index of the last `c` in the buffer, or -1. Stands in for String.prototype.lastIndexOf in the
// ported algorithm.
static long buf_last_index_of(const Buf *b, char c) {
  for (long i = (long)b->len - 1; i >= 0; --i) {
    if (b->data[i] == c) return i;
  }
  return -1;
}

static CsString *buf_to_str(const Buf *b) { return cs_str_mk(b->data, b->len); }

// Port of Node's internal normalizeString(path, allowAboveRoot, '/', isPosixPathSeparator).
// Resolves `.` and `..` segments and collapses repeated separators, appending the result to
// `res`. `allowAboveRoot` keeps leading `..` that would escape a relative root.
static void normalize_string(const char *path, size_t plen, int allow_above_root, Buf *res) {
  size_t last_segment_length = 0;
  long last_slash = -1;
  long dots = 0;
  char code = 0;

  for (size_t i = 0; i <= plen; ++i) {
    if (i < plen) {
      code = path[i];
    } else if (code == '/') {
      break;
    } else {
      code = '/';
    }

    if (code == '/') {
      if (last_slash == (long)i - 1 || dots == 1) {
        // NOOP — an empty segment ("//") or a lone ".".
      } else if (dots == 2) {
        if (res->len < 2 || last_segment_length != 2 || res->data[res->len - 1] != '.' ||
            res->data[res->len - 2] != '.') {
          if (res->len > 2) {
            long last_slash_index = buf_last_index_of(res, '/');
            if (last_slash_index == -1) {
              res->len = 0;
              last_segment_length = 0;
            } else {
              res->len = (size_t)last_slash_index;
              last_segment_length = res->len - 1 - (size_t)buf_last_index_of(res, '/');
            }
            last_slash = (long)i;
            dots = 0;
            continue;
          } else if (res->len != 0) {
            res->len = 0;
            last_segment_length = 0;
            last_slash = (long)i;
            dots = 0;
            continue;
          }
        }
        if (allow_above_root) {
          if (res->len > 0) buf_append(res, "/..", 3);
          else buf_append(res, "..", 2);
          last_segment_length = 2;
        }
      } else {
        if (res->len > 0) buf_append(res, "/", 1);
        buf_append(res, path + last_slash + 1, i - (size_t)last_slash - 1);
        last_segment_length = i - (size_t)last_slash - 1;
      }
      last_slash = (long)i;
      dots = 0;
    } else if (code == '.' && dots != -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
}

CsString *cs_path_normalize(const CsString *p) {
  if (p->len == 0) return cs_str_mk(".", 1);
  int is_absolute = p->data[0] == '/';
  int trailing_separator = p->data[p->len - 1] == '/';

  Buf res = buf_new();
  normalize_string(p->data, p->len, !is_absolute, &res);

  if (res.len == 0) {
    if (is_absolute) return cs_str_mk("/", 1);
    return trailing_separator ? cs_str_mk("./", 2) : cs_str_mk(".", 1);
  }
  if (trailing_separator) buf_append(&res, "/", 1);
  if (!is_absolute) return buf_to_str(&res);

  Buf out = buf_new();
  buf_append(&out, "/", 1);
  buf_append(&out, res.data, res.len);
  return buf_to_str(&out);
}

CsString *cs_path_join(const CsArray *parts) {
  Buf joined = buf_new();
  int any = 0;
  for (int32_t i = 0; i < parts->len; ++i) {
    const CsString *s = (const CsString *)(intptr_t)parts->data[i];
    if (s->len == 0) continue;  // Node skips empty segments entirely, including the separator.
    if (any) buf_append(&joined, "/", 1);
    buf_append(&joined, s->data, s->len);
    any = 1;
  }
  if (!any) return cs_str_mk(".", 1);
  CsString tmp = {joined.data, joined.len};
  return cs_path_normalize(&tmp);
}

CsString *cs_path_dirname(const CsString *p) {
  if (p->len == 0) return cs_str_mk(".", 1);
  int has_root = p->data[0] == '/';
  long end = -1;
  int matched_slash = 1;
  for (long i = (long)p->len - 1; i >= 1; --i) {
    if (p->data[i] == '/') {
      if (!matched_slash) {
        end = i;
        break;
      }
    } else {
      matched_slash = 0;
    }
  }
  if (end == -1) return has_root ? cs_str_mk("/", 1) : cs_str_mk(".", 1);
  // "//foo" dirnames to "//" — POSIX reserves a leading double slash, and Node preserves it.
  if (has_root && end == 1) return cs_str_mk("//", 2);
  return cs_str_from(p->data, (size_t)end);
}

CsString *cs_path_basename(const CsString *p) {
  long start = 0;
  long end = -1;
  int matched_slash = 1;
  for (long i = (long)p->len - 1; i >= 0; --i) {
    if (p->data[i] == '/') {
      // Only the FIRST slash after the last non-slash byte ends the scan: trailing slashes are
      // skipped, so basename("/foo/bar//") is "bar".
      if (!matched_slash) {
        start = i + 1;
        break;
      }
    } else if (end == -1) {
      matched_slash = 0;
      end = i + 1;
    }
  }
  if (end == -1) return cs_str_mk("", 0);
  return cs_str_from(p->data + start, (size_t)(end - start));
}

CsString *cs_path_extname(const CsString *p) {
  long start_dot = -1;
  long start_part = 0;
  long end = -1;
  int matched_slash = 1;
  // 0 = start of segment, 1 = saw one or more dots, -1 = saw a non-dot byte after a dot.
  // Distinguishes "index.js" (has an extension) from ".bashrc" and ".." (neither does).
  int pre_dot_state = 0;

  for (long i = (long)p->len - 1; i >= 0; --i) {
    char code = p->data[i];
    if (code == '/') {
      if (!matched_slash) {
        start_part = i + 1;
        break;
      }
      continue;
    }
    if (end == -1) {
      matched_slash = 0;
      end = i + 1;
    }
    if (code == '.') {
      if (start_dot == -1) start_dot = i;
      else if (pre_dot_state != 1) pre_dot_state = 1;
    } else if (start_dot != -1) {
      pre_dot_state = -1;
    }
  }

  if (start_dot == -1 || end == -1 || pre_dot_state == 0 ||
      (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part + 1)) {
    return cs_str_mk("", 0);
  }
  return cs_str_from(p->data + start_dot, (size_t)(end - start_dot));
}

int cs_path_is_absolute(const CsString *p) { return p->len > 0 && p->data[0] == '/'; }

CsString *cs_path_resolve(const CsArray *parts) {
  Buf resolved = buf_new();
  int absolute = 0;

  // Node walks right-to-left and stops at the first absolute segment: everything to its left is
  // irrelevant, so resolve("/a", "/b") is "/b".
  for (int32_t i = parts->len - 1; i >= 0 && !absolute; --i) {
    const CsString *s = (const CsString *)(intptr_t)parts->data[i];
    if (s->len == 0) continue;
    Buf next = buf_new();
    buf_append(&next, s->data, s->len);
    buf_append(&next, "/", 1);
    buf_append(&next, resolved.data, resolved.len);
    resolved = next;
    absolute = s->data[0] == '/';
  }

  if (!absolute) {
    char cwd[4096];
    if (getcwd(cwd, sizeof cwd) == NULL) {
      CsString msg = {"path.resolve: getcwd failed", 27};
      cs_throw(cs_new_error(&msg));
    }
    size_t cwd_len = strlen(cwd);
    Buf next = buf_new();
    buf_append(&next, cwd, cwd_len);
    buf_append(&next, "/", 1);
    buf_append(&next, resolved.data, resolved.len);
    resolved = next;
    absolute = cwd_len > 0 && cwd[0] == '/';
  }

  Buf out = buf_new();
  normalize_string(resolved.data, resolved.len, !absolute, &out);
  if (!absolute) return out.len > 0 ? buf_to_str(&out) : cs_str_mk(".", 1);

  Buf rooted = buf_new();
  buf_append(&rooted, "/", 1);
  buf_append(&rooted, out.data, out.len);
  return buf_to_str(&rooted);
}
