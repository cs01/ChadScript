// @test-exit-code: 10
function double(x: number) {
  return x + x;
}

function testForEach() {
  const arr = [1, 2, 3, 4];
  arr.forEach(double);
  return 10;
}

process.exit(testForEach());
