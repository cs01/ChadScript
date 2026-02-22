// @test-exit-code: 17
// Test: Multiple function calls in expression
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

function combined(x, y, z) {
  return add(x, y) + multiply(y, z);
}

process.exit(combined(2, 3, 4));
