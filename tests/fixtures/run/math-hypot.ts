// Math.hypot: arity 0..4, NaN / Infinity precedence, signed zeros, overflow-safe scaling, and a
// sweep where libm's hypot would differ from Node in the last bit.
console.log(Math.hypot(), Math.hypot(-0), Math.hypot(-0, -0), Math.hypot(3, 4), Math.hypot(-5));
console.log(Math.hypot(NaN, Infinity), Math.hypot(Infinity, NaN), Math.hypot(NaN, 1));
console.log(Math.hypot(-Infinity, 2), Math.hypot(1e300, 1e300), Math.hypot(1e-300, 1e-300));
console.log(Math.hypot(5e-324, 5e-324), Math.hypot(1, 2, 3), Math.hypot(1, 2, 3, 4));
console.log(Math.hypot(1.7976931348623157e308, 1.7976931348623157e308, 1));
let seed = 7;
function next(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return (seed / 2147483648 - 0.5) * 200;
}
for (let i = 0; i < 300; i++) {
  const a = next();
  const b = next();
  const c = next();
  console.log(
    Math.hypot(a, b),
    Math.hypot(a, b, c),
    Math.hypot(a * 1e-5, b),
    Math.hypot(i * 0.25, i + 0.5),
  );
}
const pts: number[][] = [
  [0, 0],
  [3, 4],
  [6, 8],
  [-1.5, 2.25],
];
let total = 0;
for (let i = 1; i < pts.length; i++) {
  total += Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!);
}
console.log(total);
