// @test-exit-code: 5
function testAnd(a: number, b: number) {
  return a && b;
}

function testOr(a: number, b: number) {
  return a || b;
}

function testNot(a: number) {
  return !a;
}

process.exit(testOr(0, 5));
