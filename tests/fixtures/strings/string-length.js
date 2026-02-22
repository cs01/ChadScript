// @test-exit-code: 5
function getLength() {
  let str = "Hello";
  return str.length;
}

process.exit(getLength());
