// @test-exit-code: 32
// Test: Complex arithmetic expression
function complex(a: number, b: number, c: number, d: number) {
  return a * b + c - d;
}

process.exit(complex(5, 6, 10, 8));
