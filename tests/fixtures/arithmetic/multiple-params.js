// @test-exit-code: 15
// Test: Function with multiple parameters
function sum(a, b, c, d, e) {
  return a + b + c + d + e;
}

process.exit(sum(1, 2, 3, 4, 5));
