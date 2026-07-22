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

// JS Math.max/min are variadic; codegen folds them pairwise through these. Unlike C fmax/fmin,
// JS PROPAGATES NaN, and distinguishes ±0 (max prefers +0, min prefers -0).
double cs_math_max2(double a, double b) {
  if (isnan(a) || isnan(b)) return NAN;
  if (a != b) return a > b ? a : b;
  if (a == 0.0) return (signbit(a) && signbit(b)) ? -0.0 : 0.0; // +0 unless both -0
  return a;
}
double cs_math_min2(double a, double b) {
  if (isnan(a) || isnan(b)) return NAN;
  if (a != b) return a < b ? a : b;
  if (a == 0.0) return (signbit(a) || signbit(b)) ? -0.0 : 0.0; // -0 if either -0
  return a;
}
