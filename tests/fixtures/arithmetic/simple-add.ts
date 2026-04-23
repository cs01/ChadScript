// @test-exit-code: 12
// Test: Simple addition
function add(a: number, b: number) {
  return a + b;
}

process.exit(add(5, 7));
