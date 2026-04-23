// @test-exit-code: 1
function testRegex() {
  const pattern = /^[a-z]+$/;
  const str = "hello";
  return pattern.test(str);
}

process.exit(testRegex());
