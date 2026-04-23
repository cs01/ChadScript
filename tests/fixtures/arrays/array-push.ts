// @test-exit-code: 4
function testPush() {
  const arr = [10, 20, 30];
  const newLen = arr.push(40);
  return newLen;
}

process.exit(testPush());
