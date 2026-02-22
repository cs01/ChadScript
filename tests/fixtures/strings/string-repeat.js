// @test-exit-code: 6
function test() {
  let str = "ab";
  let result = str.repeat(3);
  console.log(result);
  return result.length;
}

process.exit(test());
