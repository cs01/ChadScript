const nums = [1, 2, 3, 4, 5];
const removedNums = nums.splice(1, 2);

const strs = ["a", "b", "c", "d"];
const removedStrs = strs.splice(1, 2);

if (
  removedNums.length === 2 &&
  removedNums[0] === 2 &&
  removedNums[1] === 3 &&
  nums.length === 3 &&
  removedStrs.length === 2 &&
  removedStrs[0] === "b" &&
  removedStrs[1] === "c" &&
  strs.length === 2
) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL");
}
