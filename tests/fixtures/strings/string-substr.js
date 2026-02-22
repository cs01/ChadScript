// @test-exit-code: 3
function testSubstr() {
  let str = "Hello";
  return str.substr(1, 3).length;
}

process.exit(testSubstr());
