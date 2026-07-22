// Math.* helpers whose JS semantics differ from libm. floor/ceil/trunc/fabs/sqrt/cbrt/pow map
// directly to libm and are called from codegen; only these two need custom logic.

#include <math.h>

// JS Math.round: round half toward +Infinity (NOT C round's half-away-from-zero), and produce
// -0 for inputs in (-0.5, 0]. Computed via floor to avoid the x+0.5 rounding pitfall.
double cs_math_round(double x) {
  if (!isfinite(x)) return x;
  double f = floor(x);
  double r = (x - f >= 0.5) ? f + 1.0 : f;
  if (r == 0.0 && x < 0.0) return -0.0; // JS: Math.round(-0.3) === -0
  return r;
}

// JS Math.sign: -1 / +1 / NaN, and preserves ±0.
double cs_math_sign(double x) {
  if (isnan(x)) return x;
  if (x > 0.0) return 1.0;
  if (x < 0.0) return -1.0;
  return x; // +0 or -0 unchanged
}
