const nums: number[] = [0, 0, 0, 0, 0];
let i = 0;
while (i < 5) {
  nums[i] = (i + 1) * 10;
  i = i + 1;
}

let sum = 0;
let j = 0;
while (j < 5) {
  sum = sum + nums[j];
  j = j + 1;
}

const strs: string[] = ["a", "b", "c"];
strs[0] = "x";
strs[2] = "z";

if (sum === 150 && strs[0] === "x" && strs[1] === "b" && strs[2] === "z") {
  console.log("TEST_PASSED");
}
