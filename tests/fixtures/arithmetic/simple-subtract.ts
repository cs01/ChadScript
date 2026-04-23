// @test-exit-code: 7
// Test: Simple subtraction
function subtract(a: number, b: number) {
  return a - b;
}

process.exit(subtract(10, 3));
