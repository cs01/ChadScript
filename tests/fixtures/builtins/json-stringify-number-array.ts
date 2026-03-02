// @test-description: json stringify number array
const nums: number[] = [1, 2, 3];
const result = JSON.stringify(nums);
if (result.includes("1") && result.includes("2") && result.includes("3")) {
  console.log("TEST_PASSED");
}
