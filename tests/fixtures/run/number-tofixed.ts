// Number.prototype.toFixed: exact-binary-value rounding (ties up), sign rules, the 1e21 cutoff,
// digit-argument coercion, and the RangeError.
const xs: number[] = [
  0,
  -0,
  1,
  -1,
  2.5,
  -2.5,
  0.5,
  1.5,
  3.5,
  0.125,
  0.375,
  1.005,
  1.45,
  8.345,
  10.235,
  0.1 + 0.2,
  1e21,
  -1e21,
  9.999e20,
  1e-7,
  -1e-7,
  -0.0001,
  123.456,
  999.995,
  0.000001,
  1234567.891,
  Number.MAX_SAFE_INTEGER,
  5e-324,
  NaN,
  Infinity,
  -Infinity,
  1 / 3,
  2 / 3,
  -(2 / 3),
];
for (const x of xs) {
  console.log(x.toFixed(), x.toFixed(0), x.toFixed(1), x.toFixed(2), x.toFixed(3));
}
console.log((1.005).toFixed(20), (0.1).toFixed(20), (123.456).toFixed(50));
console.log((5e-324).toFixed(100));
console.log((1e20).toFixed(5), (-1.5e-10).toFixed(2), (9.95).toFixed(1), (99.5).toFixed(0));
console.log((1).toFixed(2.7), (1).toFixed(-0.5), (1.5).toFixed(NaN));
const price = 19.999;
const qty = 3;
console.log(`total: $${(price * qty).toFixed(2)} (${(qty / 7).toFixed(4)})`);
const label: string = "x=" + (0.045).toFixed(2);
console.log(label, label.length);
for (const d of [-1, 101, Infinity]) {
  try {
    console.log((1.5).toFixed(d));
  } catch (e) {
    if (e instanceof RangeError) console.log("RangeError:", e.message);
  }
}
try {
  console.log(NaN.toFixed(200));
} catch (e) {
  if (e instanceof Error) console.log(e.name, e.message);
}
