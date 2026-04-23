// @test-exit-code: 5
// Test: Simple division
function divide(a: number, b: number) {
  return a / b;
}

process.exit(divide(20, 4));
