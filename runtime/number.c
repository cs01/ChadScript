// JS-exact number formatting. The predecessor diverged here by leaning on printf %g; this
// implements the ECMAScript Number::toString algorithm (spec 6.1.6.1.20) so output matches
// Node byte-for-byte: shortest round-tripping digits, JS decimal/exponent placement, and the
// "Infinity"/"NaN"/"0"/"-0"→"0" spellings.

#include "number.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gc.h>

// Shortest decimal for a finite, positive x: fills `digits` with the significant digit string
// (no point, no sign, no trailing zeros) and returns via *nOut the ECMAScript `n` (the power
// such that value = digits × 10^(n - k), i.e. the decimal point sits after position n).
// `digits` must hold at least 18 bytes. Returns k (number of significant digits).
static int shortest_digits(double x, char *digits, int *nOut) {
  char buf[32];
  // Find the smallest precision whose %e round-trips exactly; that yields the shortest
  // significant-digit string (ties resolved to the correctly-rounded nearest, as JS requires).
  int prec = 0;
  for (; prec <= 16; prec++) {
    snprintf(buf, sizeof buf, "%.*e", prec, x);
    if (strtod(buf, NULL) == x) break;
  }
  snprintf(buf, sizeof buf, "%.*e", prec, x);

  // buf looks like "d.ddddde±XX" (or "d e±XX" when prec == 0). Extract mantissa digits + exp.
  char mant[32];
  int mi = 0;
  const char *p = buf;
  for (; *p && *p != 'e' && *p != 'E'; p++) {
    if (*p >= '0' && *p <= '9') mant[mi++] = *p;
  }
  mant[mi] = '\0';
  int exp10 = atoi(p + 1); // exponent of the leading digit (value = d.ddd × 10^exp10)

  // Strip trailing zeros from the mantissa to get the minimal digit string.
  int k = mi;
  while (k > 1 && mant[k - 1] == '0') k--;
  memcpy(digits, mant, k);
  digits[k] = '\0';

  *nOut = exp10 + 1; // point sits after position n; leading digit is at 10^(n-1)
  return k;
}

// Writes the ECMAScript string form of finite positive x into out (>= 32 bytes).
static void format_positive(double x, char *out) {
  char digits[18];
  int n;
  int k = shortest_digits(x, digits, &n);
  char *o = out;

  if (k <= n && n <= 21) {
    // Integer with trailing zeros: all digits, then (n-k) zeros.
    memcpy(o, digits, k);
    o += k;
    for (int i = 0; i < n - k; i++) *o++ = '0';
    *o = '\0';
  } else if (0 < n && n <= 21) {
    // Point falls inside the digits.
    memcpy(o, digits, n);
    o += n;
    *o++ = '.';
    memcpy(o, digits + n, k - n);
    o += k - n;
    *o = '\0';
  } else if (-6 < n && n <= 0) {
    // Small magnitude: "0." then (-n) zeros then digits.
    *o++ = '0';
    *o++ = '.';
    for (int i = 0; i < -n; i++) *o++ = '0';
    memcpy(o, digits, k);
    o += k;
    *o = '\0';
  } else {
    // Exponential form. Exponent is n-1, with explicit sign.
    int e = n - 1;
    *o++ = digits[0];
    if (k > 1) {
      *o++ = '.';
      memcpy(o, digits + 1, k - 1);
      o += k - 1;
    }
    *o++ = 'e';
    *o++ = (e >= 0) ? '+' : '-';
    snprintf(o, 12, "%d", e >= 0 ? e : -e);
  }
}

// ECMAScript ToInt32 (spec 7.1.6): the coercion JS bitwise operators apply to their operands.
// NaN/±Infinity → 0; otherwise truncate toward zero, reduce modulo 2^32, reinterpret as a
// signed 32-bit integer. The result's raw 32 bits also serve ToUint32 (same bits, the caller
// picks signed vs unsigned when converting back to a double). This is the piece v1 got wrong
// (it did 64-bit bitwise), so it must match JS exactly.
int cs_to_int32(double x) {
  if (!isfinite(x)) return 0;
  double t = trunc(x);
  double m = fmod(t, 4294967296.0); // 2^32
  if (m < 0) m += 4294967296.0;     // into [0, 2^32)
  return (int)(unsigned int)m;      // wrap to uint32 bits, reinterpret as int32
}

void cs_num_to_str(double x, char *out) {
  if (isnan(x)) {
    strcpy(out, "NaN");
    return;
  }
  if (x == 0.0) {
    // Both +0 and -0 print as "0" in JS.
    strcpy(out, "0");
    return;
  }
  if (isinf(x)) {
    strcpy(out, x < 0 ? "-Infinity" : "Infinity");
    return;
  }
  if (x < 0) {
    out[0] = '-';
    format_positive(-x, out + 1);
    return;
  }
  format_positive(x, out);
}

// Number.prototype.toString(radix) for radix in [2,36]. Ported from V8's DoubleToRadixCString so
// the digit sequence (integer + fractional, with correct round-to-nearest carry) matches Node
// byte-for-byte. radix 10, NaN, ±0, and ±Infinity are handled by the caller via cs_num_to_str.
static const char kRadixChars[] = "0123456789abcdefghijklmnopqrstuvwxyz";
char *cs_num_to_radix(double value, int radix) {
  const int kBufSize = 2200;
  char buffer[kBufSize];
  int integer_cursor = kBufSize / 2;
  int fraction_cursor = integer_cursor;

  int negative = value < 0;
  if (negative) value = -value;

  double integer = floor(value);
  double fraction = value - integer;

  // Fractional part: multiply-extract with a half-ULP delta driving termination + rounding.
  double delta = 0.5 * (nextafter(value, (double)INFINITY) - value);
  double smallest = nextafter(0.0, (double)INFINITY);
  if (delta < smallest) delta = smallest;
  if (fraction >= delta) {
    buffer[fraction_cursor++] = '.';
    for (;;) {
      fraction *= radix;
      delta *= radix;
      int digit = (int)fraction;
      buffer[fraction_cursor++] = kRadixChars[digit];
      fraction -= digit;
      if (fraction > 0.5 || (fraction == 0.5 && (digit & 1))) {
        if (fraction + delta > 1) {
          // Round up: carry back through the already-written digits.
          for (;;) {
            fraction_cursor--;
            if (fraction_cursor == kBufSize / 2) {
              integer += 1; // carry into the integer part
              break;
            }
            char c = buffer[fraction_cursor];
            int d = c > '9' ? (c - 'a' + 10) : (c - '0');
            if (d + 1 < radix) {
              buffer[fraction_cursor++] = kRadixChars[d + 1];
              break;
            }
          }
          break;
        }
      }
      if (fraction < delta) break;
    }
  }

  // Integer part, written downward. For values >= 2^53 the ULP exceeds 1, so shift by radix and
  // pad with zeros (matches V8's exponent-driven path); rare in practice.
  while (integer >= 9007199254740992.0) {
    integer /= radix;
    buffer[--integer_cursor] = '0';
  }
  do {
    double remainder = fmod(integer, radix);
    buffer[--integer_cursor] = kRadixChars[(int)remainder];
    integer = (integer - remainder) / radix;
  } while (integer > 0);

  int len = fraction_cursor - integer_cursor;
  char *result = GC_malloc((size_t)len + (negative ? 1 : 0) + 1);
  int k = 0;
  if (negative) result[k++] = '-';
  for (int i = integer_cursor; i < fraction_cursor; i++) result[k++] = buffer[i];
  result[k] = '\0';
  return result;
}
