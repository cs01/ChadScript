// @test-exit-code: 3
function isGreaterThan2(x) {
  let result = 0;
  if (x > 2) {
    result = 1;
  }
  return result;
}

function testFind() {
  const arr = [1, 2, 3, 4];
  return arr.find(isGreaterThan2);
}

process.exit(testFind());
