// JSON.parse's runtime half: text → a generic tagged tree. Codegen walks that tree against the
// STATIC target shape (see src/codegen/json-parse.ts), mirroring how stringify is type-directed —
// the runtime never learns what shape it is building, and the compiler never parses text.
//
// Strict RFC 8259, which is what Node accepts: no trailing commas, no comments, no single quotes,
// no leading `+`, no leading zeros, no NaN/Infinity literals. Duplicate object keys keep the LAST
// occurrence, as Node does.
//
// Non-ASCII is REFUSED rather than approximated. The charter locks strings to ASCII-exact, so a
// `é` escape or a raw high byte would produce a value the rest of the language does not
// promise to handle correctly. Throwing keeps the ASCII invariant true instead of documenting an
// exception to it.

#include "strings.h"
#include <gc.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct CsThrown CsThrown;
extern CsThrown *cs_new_error(const CsString *message);
extern void cs_throw(CsThrown *value);

enum { JSON_NULL = 0, JSON_BOOL = 1, JSON_NUMBER = 2, JSON_STRING = 3, JSON_ARRAY = 4, JSON_OBJECT = 5 };

typedef struct JsonValue {
  int kind;
  int bval;
  double num;
  CsString *str;
  struct JsonValue **items;  // JSON_ARRAY
  int count;
  CsString **keys;           // JSON_OBJECT (parallel with vals)
  struct JsonValue **vals;
  int nfields;
} JsonValue;

typedef struct {
  const char *s;
  size_t len;
  size_t i;
} Parser;

// cs_new_error STORES the CsString pointer it is given (it does not copy), so the header must be
// GC memory that outlives this frame — a stack `CsString` here dangles and the catch reads freed
// memory.
static void fail(const char *msg) {
  cs_throw(cs_new_error(cs_str_mk(msg, strlen(msg))));
}

static JsonValue *jv_new(int kind) {
  JsonValue *v = GC_malloc(sizeof(JsonValue));
  v->kind = kind;
  return v;
}

static void skip_ws(Parser *p) {
  while (p->i < p->len) {
    char c = p->s[p->i];
    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') p->i++;
    else break;
  }
}

static JsonValue *parse_value(Parser *p);

static void expect(Parser *p, char c) {
  if (p->i >= p->len || p->s[p->i] != c) fail("JSON.parse: unexpected token");
  p->i++;
}

static void parse_literal(Parser *p, const char *lit) {
  size_t n = strlen(lit);
  if (p->i + n > p->len || memcmp(p->s + p->i, lit, n) != 0) fail("JSON.parse: unexpected token");
  p->i += n;
}

// A growable byte buffer for decoded string contents (escapes make the result shorter or equal,
// but building it incrementally is simpler than measuring twice).
typedef struct {
  char *data;
  size_t len, cap;
} SBuf;

static void sbuf_push(SBuf *b, char c) {
  if (b->len == b->cap) {
    size_t cap = b->cap ? b->cap * 2 : 32;
    char *grown = GC_malloc_atomic(cap);
    memcpy(grown, b->data, b->len);
    b->data = grown;
    b->cap = cap;
  }
  b->data[b->len++] = c;
}

static int hex_digit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static CsString *parse_string(Parser *p) {
  expect(p, '"');
  SBuf b = {NULL, 0, 0};
  while (1) {
    if (p->i >= p->len) fail("JSON.parse: unterminated string");
    unsigned char c = (unsigned char)p->s[p->i];
    if (c == '"') {
      p->i++;
      break;
    }
    if (c == '\\') {
      p->i++;
      if (p->i >= p->len) fail("JSON.parse: unterminated escape");
      char e = p->s[p->i++];
      switch (e) {
        case '"': sbuf_push(&b, '"'); break;
        case '\\': sbuf_push(&b, '\\'); break;
        case '/': sbuf_push(&b, '/'); break;
        case 'b': sbuf_push(&b, '\b'); break;
        case 'f': sbuf_push(&b, '\f'); break;
        case 'n': sbuf_push(&b, '\n'); break;
        case 'r': sbuf_push(&b, '\r'); break;
        case 't': sbuf_push(&b, '\t'); break;
        case 'u': {
          if (p->i + 4 > p->len) fail("JSON.parse: truncated \\u escape");
          int cp = 0;
          for (int k = 0; k < 4; k++) {
            int d = hex_digit(p->s[p->i + k]);
            if (d < 0) fail("JSON.parse: invalid \\u escape");
            cp = cp * 16 + d;
          }
          p->i += 4;
          // ASCII-exact: a non-ASCII code point has no representation this language promises.
          if (cp > 0x7F) fail("JSON.parse: non-ASCII characters are not supported");
          sbuf_push(&b, (char)cp);
          break;
        }
        default: fail("JSON.parse: invalid escape");
      }
      continue;
    }
    if (c < 0x20) fail("JSON.parse: control character in string");
    if (c > 0x7F) fail("JSON.parse: non-ASCII characters are not supported");
    sbuf_push(&b, (char)c);
    p->i++;
  }
  return cs_str_from(b.data, b.len);
}

static JsonValue *parse_number(Parser *p) {
  size_t start = p->i;
  if (p->i < p->len && p->s[p->i] == '-') p->i++;
  // Integer part: a single 0, or a nonzero digit followed by digits. Leading zeros are invalid.
  if (p->i >= p->len) fail("JSON.parse: unexpected end of number");
  if (p->s[p->i] == '0') {
    p->i++;
  } else if (p->s[p->i] >= '1' && p->s[p->i] <= '9') {
    while (p->i < p->len && p->s[p->i] >= '0' && p->s[p->i] <= '9') p->i++;
  } else {
    fail("JSON.parse: unexpected token");
  }
  if (p->i < p->len && p->s[p->i] == '.') {
    p->i++;
    if (p->i >= p->len || p->s[p->i] < '0' || p->s[p->i] > '9') fail("JSON.parse: malformed number");
    while (p->i < p->len && p->s[p->i] >= '0' && p->s[p->i] <= '9') p->i++;
  }
  if (p->i < p->len && (p->s[p->i] == 'e' || p->s[p->i] == 'E')) {
    p->i++;
    if (p->i < p->len && (p->s[p->i] == '+' || p->s[p->i] == '-')) p->i++;
    if (p->i >= p->len || p->s[p->i] < '0' || p->s[p->i] > '9') fail("JSON.parse: malformed exponent");
    while (p->i < p->len && p->s[p->i] >= '0' && p->s[p->i] <= '9') p->i++;
  }
  // strtod needs a NUL-terminated buffer; the slice is already validated as a JSON number, whose
  // grammar is a strict subset of what strtod accepts, so it consumes exactly this span.
  size_t n = p->i - start;
  char *buf = GC_malloc_atomic(n + 1);
  memcpy(buf, p->s + start, n);
  buf[n] = '\0';
  JsonValue *v = jv_new(JSON_NUMBER);
  v->num = strtod(buf, NULL);
  return v;
}

static JsonValue *parse_array(Parser *p) {
  expect(p, '[');
  JsonValue *v = jv_new(JSON_ARRAY);
  int cap = 8;
  v->items = GC_malloc((size_t)cap * sizeof(JsonValue *));
  v->count = 0;
  skip_ws(p);
  if (p->i < p->len && p->s[p->i] == ']') {
    p->i++;
    return v;
  }
  while (1) {
    if (v->count == cap) {
      cap *= 2;
      JsonValue **grown = GC_malloc((size_t)cap * sizeof(JsonValue *));
      for (int k = 0; k < v->count; k++) grown[k] = v->items[k];
      v->items = grown;
    }
    v->items[v->count++] = parse_value(p);
    skip_ws(p);
    if (p->i < p->len && p->s[p->i] == ',') {
      p->i++;
      skip_ws(p);
      continue;
    }
    expect(p, ']');
    return v;
  }
}

static JsonValue *parse_object(Parser *p) {
  expect(p, '{');
  JsonValue *v = jv_new(JSON_OBJECT);
  int cap = 8;
  v->keys = GC_malloc((size_t)cap * sizeof(CsString *));
  v->vals = GC_malloc((size_t)cap * sizeof(JsonValue *));
  v->nfields = 0;
  skip_ws(p);
  if (p->i < p->len && p->s[p->i] == '}') {
    p->i++;
    return v;
  }
  while (1) {
    skip_ws(p);
    CsString *key = parse_string(p);
    skip_ws(p);
    expect(p, ':');
    skip_ws(p);
    JsonValue *val = parse_value(p);
    // Duplicate keys: last occurrence wins, matching Node.
    int existing = -1;
    for (int k = 0; k < v->nfields; k++) {
      if (cs_str_eq(v->keys[k], key)) {
        existing = k;
        break;
      }
    }
    if (existing >= 0) {
      v->vals[existing] = val;
    } else {
      if (v->nfields == cap) {
        cap *= 2;
        CsString **gk = GC_malloc((size_t)cap * sizeof(CsString *));
        JsonValue **gv = GC_malloc((size_t)cap * sizeof(JsonValue *));
        for (int k = 0; k < v->nfields; k++) {
          gk[k] = v->keys[k];
          gv[k] = v->vals[k];
        }
        v->keys = gk;
        v->vals = gv;
      }
      v->keys[v->nfields] = key;
      v->vals[v->nfields] = val;
      v->nfields++;
    }
    skip_ws(p);
    if (p->i < p->len && p->s[p->i] == ',') {
      p->i++;
      continue;
    }
    expect(p, '}');
    return v;
  }
}

static JsonValue *parse_value(Parser *p) {
  skip_ws(p);
  if (p->i >= p->len) fail("JSON.parse: unexpected end of input");
  char c = p->s[p->i];
  switch (c) {
    case '{': return parse_object(p);
    case '[': return parse_array(p);
    case '"': {
      JsonValue *v = jv_new(JSON_STRING);
      v->str = parse_string(p);
      return v;
    }
    case 't': parse_literal(p, "true"); { JsonValue *v = jv_new(JSON_BOOL); v->bval = 1; return v; }
    case 'f': parse_literal(p, "false"); { JsonValue *v = jv_new(JSON_BOOL); v->bval = 0; return v; }
    case 'n': parse_literal(p, "null"); return jv_new(JSON_NULL);
    default: return parse_number(p);
  }
}

JsonValue *cs_json_parse(const CsString *text) {
  Parser p = {text->data, text->len, 0};
  JsonValue *v = parse_value(&p);
  skip_ws(&p);
  if (p.i != p.len) fail("JSON.parse: unexpected trailing content");
  return v;
}

// Accessors. Codegen calls these after checking the kind, so a mismatch is the compiler's bug
// rather than the user's — except cs_json_expect, which reports the USER's shape mismatch.
int cs_json_kind(const JsonValue *v) { return v->kind; }
double cs_json_number_of(const JsonValue *v) { return v->num; }
int cs_json_bool_of(const JsonValue *v) { return v->bval; }
CsString *cs_json_string_of(const JsonValue *v) { return v->str; }
int cs_json_array_len(const JsonValue *v) { return v->count; }
JsonValue *cs_json_array_get(const JsonValue *v, int i) { return v->items[i]; }

// Field lookup by name; NULL when absent (codegen decides whether that is an error, since an
// optional field may legitimately be missing).
JsonValue *cs_json_field(const JsonValue *v, const CsString *key) {
  if (v->kind != JSON_OBJECT) return NULL;
  for (int k = 0; k < v->nfields; k++) {
    if (cs_str_eq(v->keys[k], key)) return v->vals[k];
  }
  return NULL;
}

// The shape-mismatch throw. `path` is the compile-time-known location in the target type (e.g.
// "value.items[]"), so the message names WHERE the JSON disagreed with T.
void cs_json_expect_fail(const CsString *path, const CsString *expected) {
  SBuf b = {NULL, 0, 0};
  const char *pre = "JSON.parse: expected ";
  for (const char *q = pre; *q; q++) sbuf_push(&b, *q);
  for (size_t k = 0; k < expected->len; k++) sbuf_push(&b, expected->data[k]);
  const char *mid = " at ";
  for (const char *q = mid; *q; q++) sbuf_push(&b, *q);
  for (size_t k = 0; k < path->len; k++) sbuf_push(&b, path->data[k]);
  cs_throw(cs_new_error(cs_str_mk(b.data, b.len)));
}
