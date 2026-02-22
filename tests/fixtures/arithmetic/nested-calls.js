// @test-exit-code: 17
// Test: Nested function calls
function multiply(a, b) {
  return a * b;
}

function calculate(x, y) {
  return multiply(x, y) - 3;
}

process.exit(calculate(4, 5));
