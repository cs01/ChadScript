// @test-exit-code: 42
// Test: Simple multiplication
function multiply(a, b) {
  return a * b;
}

process.exit(multiply(6, 7));
