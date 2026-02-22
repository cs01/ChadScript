// @test-exit-code: 2
function modulo(a, b) {
  return a % b;
}

process.exit(modulo(17, 5));
