// JSON.stringify primitives. The recursive structure walk is emitted by codegen (src/codegen/json.ts,
// like inspect.ts); this file provides the two leaf conversions that differ from ordinary
// number/string formatting: a JSON number (non-finite → the literal `null`) and a JSON string (double
// quoted, with the JSON escape set — `\uXXXX` for control chars, not util.inspect's `\xHH`).

#include <math.h>
#include <gc.h>
#include "strings.h"

extern CsString *cs_num_to_string(double d);

// A number as JSON text: finite values use the ECMAScript Number→string form (same as elsewhere);
// NaN and ±Infinity are not representable in JSON, so JSON.stringify emits the literal `null`.
CsString *cs_json_num(double d) {
  if (!isfinite(d)) return cs_str_mk("null", 4);
  return cs_num_to_string(d);
}

// A string as a JSON string literal: wrap in double quotes and escape per RFC 8259 — `"` and `\`
// backslash-escaped, the five named control escapes (\b \t \n \f \r), and any other control byte
// (< 0x20) as \uXXXX. Bytes >= 0x20 (including UTF-8 continuation bytes) pass through unchanged
// (ASCII-exact; the unicode decision is Phase 4).
CsString *cs_json_str(const CsString *s) {
  const char *d = s->data;
  size_t n = s->len;
  // Worst case each byte becomes \uXXXX (6 bytes), plus the two quotes.
  char *r = GC_malloc(n * 6 + 2);
  size_t o = 0;
  r[o++] = '"';
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)d[i];
    char named = 0;
    if (c == '"' || c == '\\') {
      r[o++] = '\\';
      r[o++] = (char)c;
      continue;
    } else if (c == '\b') named = 'b';
    else if (c == '\t') named = 't';
    else if (c == '\n') named = 'n';
    else if (c == '\f') named = 'f';
    else if (c == '\r') named = 'r';
    if (named) {
      r[o++] = '\\';
      r[o++] = named;
    } else if (c < 0x20) {
      static const char hex[] = "0123456789abcdef";
      r[o++] = '\\';
      r[o++] = 'u';
      r[o++] = '0';
      r[o++] = '0';
      r[o++] = hex[c >> 4];
      r[o++] = hex[c & 0xf];
    } else {
      r[o++] = (char)c;
    }
  }
  r[o++] = '"';
  return cs_str_mk(r, o);
}
