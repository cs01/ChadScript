function add(a: number, b: number): number { return a + b; }
function mul(a: number, b: number): number { return a * b; }

const r1 = add(mul(2, 3), mul(4, 5));
if (r1 !== 26) process.exit(1);

const r2 = mul(add(1, 2), add(3, 4));
if (r2 !== 21) process.exit(1);

function max3(a: number, b: number, c: number): number {
  const ab = Math.max(a, b);
  return Math.max(ab, c);
}
if (max3(3, 7, 5) !== 7) process.exit(1);
if (max3(10, 2, 8) !== 10) process.exit(1);

function compose(x: number): number {
  return add(mul(x, x), mul(x, 2));
}
if (compose(3) !== 15) process.exit(1);
if (compose(5) !== 35) process.exit(1);

console.log("TEST_PASSED");
