// @test-exit-code: 15
// Test: Function with multiple parameters
function sum(a: number, b: number, c: number, d: number, e: number) {
  return a + b + c + d + e;
}

process.exit(sum(1, 2, 3, 4, 5));
