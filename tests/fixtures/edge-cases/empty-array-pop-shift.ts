const nums: number[] = [];
const n = nums.pop();
const strs: string[] = [];
const s = strs.pop();
const nums2: number[] = [];
const n2 = nums2.shift();
strs.push("a");
strs.push("b");
const popped = strs.pop();
if (popped !== "b") {
  process.exit(1);
}
if (strs.length !== 1) {
  process.exit(1);
}
console.log("TEST_PASSED");
