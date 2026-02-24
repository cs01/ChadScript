// @test-description: inline lambda with capture in array map
const offset = 10;
const nums = [1, 2, 3];
const result = nums.map(x => x + offset);
if (result[0] === 11 && result[1] === 12 && result[2] === 13) {
  console.log("TEST_PASSED");
}
