// @test-exit-code: 11
function test() {
  let str1 = "Hello";
  let str2 = " ";
  let str3 = "World";
  let result = str1.concat(str2, str3);
  console.log(result);
  return result.length;
}

process.exit(test());
