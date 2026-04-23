// @test-exit-code: 2
function modulo(a: number, b: number) {
  return a % b;
}

process.exit(modulo(17, 5));
