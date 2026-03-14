// @test-description: deeply nested function calls (3+ levels)

function double(n: number): number {
  return n * 2;
}

function add1(n: number): number {
  return n + 1;
}

function negate(n: number): number {
  return 0 - n;
}

const result = double(add1(double(3)));
if (result !== 14) {
  console.log("FAIL: double(add1(double(3))) should be 14, got " + String(result));
  process.exit(1);
}

const result2 = add1(add1(add1(add1(0))));
if (result2 !== 4) {
  console.log("FAIL: 4x add1(0) should be 4, got " + String(result2));
  process.exit(1);
}

const result3 = negate(double(add1(5)));
if (result3 !== -12) {
  console.log("FAIL: negate(double(add1(5))) should be -12, got " + String(result3));
  process.exit(1);
}

const maxResult = Math.max(Math.min(10, 20), Math.abs(-5));
if (maxResult !== 10) {
  console.log("FAIL: Math.max(Math.min(10,20), Math.abs(-5)) should be 10, got " + String(maxResult));
  process.exit(1);
}

console.log("TEST_PASSED");
