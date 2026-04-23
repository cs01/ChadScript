// @test-exit-code: 14
// Test: Operator precedence (multiplication before addition)
function compute(a: number, b: number, c: number) {
  return a + b * c;
}

process.exit(compute(2, 3, 4));
