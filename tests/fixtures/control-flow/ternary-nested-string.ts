// @test-skip
// native compiler produces corrupted .o for nested string ternaries on LLVM 22
const x = 5;
const result = x > 10 ? "huge" : x > 3 ? "big" : "small";
if (result === "big") {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
