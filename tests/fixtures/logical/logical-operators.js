// @test-exit-code: 5
function testAnd(a, b) {
  return a && b;
}

function testOr(a, b) {
  return a || b;
}

function testNot(a) {
  return !a;
}

process.exit(testOr(0, 5));
