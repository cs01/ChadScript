// @test-exit-code: 3
function test() {
  let arr = [1, 2, 3];
  return arr.length;
}

process.exit(test());
