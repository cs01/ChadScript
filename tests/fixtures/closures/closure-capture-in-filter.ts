// @test-description: inline lambda with capture in array filter
const threshold = 3;
const nums = [1, 2, 3, 4, 5];
const result = nums.filter((x) => x > threshold);
if (result.length === 2 && result[0] === 4 && result[1] === 5) {
  console.log("TEST_PASSED");
}
