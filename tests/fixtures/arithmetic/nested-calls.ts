// @test-exit-code: 17
// Test: Nested function calls
function multiply(a: number, b: number) {
  return a * b;
}

function calculate(x: number, y: number) {
  return multiply(x, y) - 3;
}

process.exit(calculate(4, 5));
