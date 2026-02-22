// @test-exit-code: 10
// Regression test: String.length returns i32 but must convert to double for arithmetic
// This tests sitofp i32 to double conversion

function test() {
  const str1 = "hello";
  const str2 = "world";

  // String lengths need to be converted from i32 to double for arithmetic
  const totalLength = str1.length + str2.length; // 5 + 5 = 10

  return totalLength;
}

process.exit(test()); // Should exit with 10
