// @test-description: inline lambda with capture in array forEach
const prefix = 100;
const nums = [1, 2, 3];
const results: number[] = [];
nums.forEach((x) => {
  results.push(x + prefix);
});
if (results.length === 3 && results[0] === 101 && results[1] === 102 && results[2] === 103) {
  console.log("TEST_PASSED");
}
