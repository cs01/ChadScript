// @test-description: bounds-check elimination for safe loop indices
// Exercises the loop pattern `while (i < arr.length)` — all accesses must
// still produce correct values even when the bounds check is elided.
const arr: number[] = [10, 20, 30, 40, 50];
let sum = 0;
let i = 0;
while (i < arr.length) {
  sum = sum + arr[i];
  i = i + 1;
}

const strs: string[] = ["a", "b", "c", "d"];
let joined = "";
let j = 0;
while (j < strs.length) {
  joined = joined + strs[j];
  j = j + 1;
}

// Classic for-loop with i < arr.length.
const nums: number[] = [1, 2, 3, 4, 5, 6];
let prod = 1;
for (let k = 0; k < nums.length; k = k + 1) {
  prod = prod * nums[k];
}

if (sum === 150 && joined === "abcd" && prod === 720) {
  console.log("TEST_PASSED");
}
