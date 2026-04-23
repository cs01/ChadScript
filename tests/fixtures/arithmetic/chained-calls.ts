// @test-exit-code: 17
// Test: Multiple function calls in expression
function add(a: number, b: number) {
  return a + b;
}

function multiply(a: number, b: number) {
  return a * b;
}

function combined(x: number, y: number, z: number) {
  return add(x, y) + multiply(y, z);
}

process.exit(combined(2, 3, 4));
