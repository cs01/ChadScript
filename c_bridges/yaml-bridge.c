#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern void *GC_malloc_atomic(size_t size);
extern void *GC_malloc(size_t size);

typedef struct {
  char *buf;
  size_t len;
  size_t cap;
} YBuf;

static void ybuf_init(YBuf *b) {
  b->cap = 256;
  b->len = 0;
  b->buf = (char *)GC_malloc_atomic(b->cap);
  b->buf[0] = '\0';
}

static void ybuf_grow(YBuf *b, size_t extra) {
  while (b->len + extra + 1 > b->cap) {
    b->cap = b->cap * 2;
  }
  char *newBuf = (char *)GC_malloc_atomic(b->cap);
  memcpy(newBuf, b->buf, b->len + 1);
  b->buf = newBuf;
}

static void ybuf_append(YBuf *b, const char *s, size_t slen) {
  if (b->len + slen + 1 > b->cap) ybuf_grow(b, slen);
  memcpy(b->buf + b->len, s, slen);
  b->len += slen;
  b->buf[b->len] = '\0';
}

static void ybuf_char(YBuf *b, char c) {
  if (b->len + 2 > b->cap) ybuf_grow(b, 1);
  b->buf[b->len++] = c;
  b->buf[b->len] = '\0';
}

static void ybuf_str(YBuf *b, const char *s) {
  ybuf_append(b, s, strlen(s));
}

static int is_whitespace(char c) { return c == ' ' || c == '\t'; }

static int starts_with(const char *s, const char *prefix) {
  return strncmp(s, prefix, strlen(prefix)) == 0;
}

static void json_escape_string(YBuf *b, const char *s, size_t len) {
  ybuf_char(b, '"');
  for (size_t i = 0; i < len; i++) {
    char c = s[i];
    switch (c) {
    case '"':
      ybuf_str(b, "\\\"");
      break;
    case '\\':
      ybuf_str(b, "\\\\");
      break;
    case '\n':
      ybuf_str(b, "\\n");
      break;
    case '\r':
      ybuf_str(b, "\\r");
      break;
    case '\t':
      ybuf_str(b, "\\t");
      break;
    default:
      ybuf_char(b, c);
    }
  }
  ybuf_char(b, '"');
}

static int is_number(const char *s, size_t len) {
  if (len == 0) return 0;
  size_t i = 0;
  if (s[0] == '-' || s[0] == '+') i = 1;
  if (i >= len) return 0;
  int has_digit = 0;
  int has_dot = 0;
  for (; i < len; i++) {
    if (s[i] >= '0' && s[i] <= '9') {
      has_digit = 1;
    } else if (s[i] == '.' && !has_dot) {
      has_dot = 1;
    } else if ((s[i] == 'e' || s[i] == 'E') && has_digit) {
      i++;
      if (i < len && (s[i] == '+' || s[i] == '-')) i++;
      for (; i < len; i++) {
        if (s[i] < '0' || s[i] > '9') return 0;
      }
      return 1;
    } else {
      return 0;
    }
  }
  return has_digit;
}

static const char *skip_line(const char *p) {
  while (*p && *p != '\n') p++;
  if (*p == '\n') p++;
  return p;
}

static int get_indent(const char *line) {
  int n = 0;
  while (line[n] == ' ') n++;
  return n;
}

static size_t trim_end(const char *s, size_t len) {
  while (len > 0 && (s[len - 1] == ' ' || s[len - 1] == '\t' || s[len - 1] == '\r')) len--;
  return len;
}

static void yaml_value_to_json(YBuf *b, const char *val, size_t vlen);

static void yaml_block_to_json(YBuf *b, const char **pp, int baseIndent);

static void yaml_value_to_json(YBuf *b, const char *val, size_t vlen) {
  vlen = trim_end(val, vlen);
  if (vlen == 0) {
    ybuf_str(b, "null");
    return;
  }
  if (vlen == 4 && strncmp(val, "true", 4) == 0) {
    ybuf_str(b, "true");
    return;
  }
  if (vlen == 5 && strncmp(val, "false", 5) == 0) {
    ybuf_str(b, "false");
    return;
  }
  if (vlen == 4 && strncmp(val, "null", 4) == 0) {
    ybuf_str(b, "null");
    return;
  }
  if (vlen == 1 && val[0] == '~') {
    ybuf_str(b, "null");
    return;
  }
  if (is_number(val, vlen)) {
    ybuf_append(b, val, vlen);
    return;
  }
  if ((val[0] == '"' && val[vlen - 1] == '"') || (val[0] == '\'' && val[vlen - 1] == '\'')) {
    json_escape_string(b, val + 1, vlen - 2);
    return;
  }
  json_escape_string(b, val, vlen);
}

static void yaml_block_to_json(YBuf *b, const char **pp, int baseIndent) {
  const char *p = *pp;
  int is_list = 0;
  int is_map = 0;
  int first = 1;

  while (*p) {
    if (*p == '\n') {
      p++;
      continue;
    }
    int indent = get_indent(p);
    if (indent < baseIndent) break;
    if (p[indent] == '#') {
      p = skip_line(p);
      continue;
    }
    if (indent > baseIndent) break;

    if (p[indent] == '-' && (p[indent + 1] == ' ' || p[indent + 1] == '\n' || p[indent + 1] == '\0')) {
      if (!is_list && !is_map) {
        is_list = 1;
        ybuf_char(b, '[');
      }
      if (!first) ybuf_char(b, ',');
      first = 0;

      const char *after = p + indent + 1;
      if (*after == ' ') after++;
      size_t linelen = 0;
      const char *lp = after;
      while (*lp && *lp != '\n') {
        linelen++;
        lp++;
      }
      size_t trimlen = trim_end(after, linelen);

      int colon_pos = -1;
      for (size_t i = 0; i < trimlen; i++) {
        if (after[i] == ':' && (i + 1 >= trimlen || after[i + 1] == ' ')) {
          colon_pos = (int)i;
          break;
        }
      }

      if (colon_pos >= 0) {
        p = p + indent + 2;
        if (*p == ' ') {
        }
        yaml_block_to_json(b, &p, indent + 2);
      } else if (trimlen == 0) {
        p = skip_line(p);
        if (*p) {
          int nextInd = get_indent(p);
          if (nextInd > indent) {
            yaml_block_to_json(b, &p, nextInd);
          } else {
            ybuf_str(b, "null");
          }
        } else {
          ybuf_str(b, "null");
        }
      } else {
        yaml_value_to_json(b, after, trimlen);
        p = skip_line(p);
      }
    } else {
      int colon_pos = -1;
      const char *line = p + indent;
      size_t linelen = 0;
      const char *lp2 = line;
      while (*lp2 && *lp2 != '\n') {
        linelen++;
        lp2++;
      }
      size_t trimlen = trim_end(line, linelen);
      for (size_t i = 0; i < trimlen; i++) {
        if (line[i] == ':' && (i + 1 >= trimlen || line[i + 1] == ' ')) {
          colon_pos = (int)i;
          break;
        }
      }

      if (colon_pos < 0) {
        p = skip_line(p);
        continue;
      }

      if (!is_map && !is_list) {
        is_map = 1;
        ybuf_char(b, '{');
      }
      if (!first) ybuf_char(b, ',');
      first = 0;

      json_escape_string(b, line, (size_t)colon_pos);
      ybuf_char(b, ':');

      const char *valStart = line + colon_pos + 1;
      while (*valStart == ' ') valStart++;
      size_t valLen = 0;
      const char *vp = valStart;
      while (*vp && *vp != '\n') {
        valLen++;
        vp++;
      }
      valLen = trim_end(valStart, valLen);

      if (valLen == 0) {
        p = skip_line(p);
        if (*p) {
          int nextInd = get_indent(p);
          if (nextInd > indent) {
            yaml_block_to_json(b, &p, nextInd);
          } else {
            ybuf_str(b, "null");
          }
        } else {
          ybuf_str(b, "null");
        }
      } else {
        yaml_value_to_json(b, valStart, valLen);
        p = skip_line(p);
      }
    }
  }

  if (is_list) ybuf_char(b, ']');
  else if (is_map) ybuf_char(b, '}');
  else ybuf_str(b, "null");

  *pp = p;
}

char *cs_yaml_parse(const char *yaml_str) {
  if (!yaml_str) return NULL;
  YBuf b;
  ybuf_init(&b);
  const char *p = yaml_str;
  if (starts_with(p, "---")) p = skip_line(p);
  yaml_block_to_json(&b, &p, 0);
  return b.buf;
}

static void json_to_yaml_recurse(YBuf *b, const char **pp, int indent);

static void emit_indent(YBuf *b, int indent) {
  for (int i = 0; i < indent; i++) ybuf_char(b, ' ');
}

static void json_skip_ws(const char **pp) {
  while (**pp == ' ' || **pp == '\t' || **pp == '\n' || **pp == '\r') (*pp)++;
}

static char *json_read_string(const char **pp) {
  const char *p = *pp;
  if (*p != '"') return NULL;
  p++;
  YBuf sb;
  ybuf_init(&sb);
  while (*p && *p != '"') {
    if (*p == '\\' && p[1]) {
      p++;
      switch (*p) {
      case '"':
        ybuf_char(&sb, '"');
        break;
      case '\\':
        ybuf_char(&sb, '\\');
        break;
      case 'n':
        ybuf_char(&sb, '\n');
        break;
      case 'r':
        ybuf_char(&sb, '\r');
        break;
      case 't':
        ybuf_char(&sb, '\t');
        break;
      default:
        ybuf_char(&sb, *p);
      }
    } else {
      ybuf_char(&sb, *p);
    }
    p++;
  }
  if (*p == '"') p++;
  *pp = p;
  return sb.buf;
}

static void json_skip_value(const char **pp) {
  json_skip_ws(pp);
  const char *p = *pp;
  if (*p == '"') {
    p++;
    while (*p && *p != '"') {
      if (*p == '\\') p++;
      p++;
    }
    if (*p == '"') p++;
    *pp = p;
  } else if (*p == '{') {
    int depth = 1;
    p++;
    while (*p && depth > 0) {
      if (*p == '{') depth++;
      else if (*p == '}') depth--;
      else if (*p == '"') {
        p++;
        while (*p && *p != '"') {
          if (*p == '\\') p++;
          p++;
        }
      }
      if (*p) p++;
    }
    *pp = p;
  } else if (*p == '[') {
    int depth = 1;
    p++;
    while (*p && depth > 0) {
      if (*p == '[') depth++;
      else if (*p == ']') depth--;
      else if (*p == '"') {
        p++;
        while (*p && *p != '"') {
          if (*p == '\\') p++;
          p++;
        }
      }
      if (*p) p++;
    }
    *pp = p;
  } else {
    while (*p && *p != ',' && *p != '}' && *p != ']') p++;
    *pp = p;
  }
}

static void json_to_yaml_recurse(YBuf *b, const char **pp, int indent) {
  json_skip_ws(pp);
  const char *p = *pp;

  if (*p == '{') {
    p++;
    json_skip_ws(&p);
    int first = 1;
    while (*p && *p != '}') {
      if (!first) {
        json_skip_ws(&p);
        if (*p == ',') p++;
        json_skip_ws(&p);
      }
      if (*p == '}') break;
      char *key = json_read_string(&p);
      json_skip_ws(&p);
      if (*p == ':') p++;
      json_skip_ws(&p);

      if (*p == '{' || *p == '[') {
        if (!first || indent > 0) {
          ybuf_char(b, '\n');
          emit_indent(b, indent);
        }
        ybuf_str(b, key);
        ybuf_str(b, ":\n");
        json_to_yaml_recurse(b, &p, indent + 2);
      } else {
        if (!first || indent > 0) {
          ybuf_char(b, '\n');
          emit_indent(b, indent);
        }
        ybuf_str(b, key);
        ybuf_str(b, ": ");
        json_to_yaml_recurse(b, &p, indent);
      }
      first = 0;
      json_skip_ws(&p);
      if (*p == ',') p++;
    }
    if (*p == '}') p++;
    *pp = p;
  } else if (*p == '[') {
    p++;
    json_skip_ws(&p);
    int first = 1;
    while (*p && *p != ']') {
      if (!first) {
        json_skip_ws(&p);
        if (*p == ',') p++;
        json_skip_ws(&p);
      }
      if (*p == ']') break;
      if (!first || indent > 0) {
        ybuf_char(b, '\n');
      }
      emit_indent(b, indent);
      ybuf_str(b, "- ");
      json_to_yaml_recurse(b, &p, indent + 2);
      first = 0;
      json_skip_ws(&p);
      if (*p == ',') p++;
    }
    if (*p == ']') p++;
    *pp = p;
  } else if (*p == '"') {
    char *s = json_read_string(&p);
    int needs_quote = 0;
    size_t slen = strlen(s);
    if (slen == 0 || strcmp(s, "true") == 0 || strcmp(s, "false") == 0 ||
        strcmp(s, "null") == 0 || is_number(s, slen)) {
      needs_quote = 1;
    }
    for (size_t i = 0; i < slen && !needs_quote; i++) {
      if (s[i] == ':' || s[i] == '#' || s[i] == '\n' || s[i] == '"' || s[i] == '\'') {
        needs_quote = 1;
      }
    }
    if (needs_quote) {
      json_escape_string(b, s, slen);
    } else {
      ybuf_str(b, s);
    }
    *pp = p;
  } else {
    const char *start = p;
    while (*p && *p != ',' && *p != '}' && *p != ']' && *p != '\n') p++;
    ybuf_append(b, start, (size_t)(p - start));
    *pp = p;
  }
}

char *cs_yaml_stringify(const char *json_str) {
  if (!json_str) return NULL;
  YBuf b;
  ybuf_init(&b);
  const char *p = json_str;
  json_to_yaml_recurse(&b, &p, 0);
  ybuf_char(&b, '\n');
  return b.buf;
}
