function testShiftUnshift(): void {
  let nums: number[] = [1, 2, 3];

  let shifted = nums.shift();
  if (shifted !== 1) {
    console.log("FAIL: shift value");
    process.exit(1);
  }
  if (nums.length !== 2) {
    console.log("FAIL: shift length");
    process.exit(1);
  }
  if (nums[0] !== 2) {
    console.log("FAIL: shift first element");
    process.exit(1);
  }

  let newLen = nums.unshift(0);
  if (newLen !== 3) {
    console.log("FAIL: unshift return value");
    process.exit(1);
  }
  if (nums[0] !== 0) {
    console.log("FAIL: unshift first element");
    process.exit(1);
  }
  if (nums[1] !== 2) {
    console.log("FAIL: unshift shifted element");
    process.exit(1);
  }

  let strs: string[] = ["b", "c"];
  strs.unshift("a");
  if (strs[0] !== "a") {
    console.log("FAIL: string unshift");
    process.exit(1);
  }

  let s = strs.shift();
  if (s !== "a") {
    console.log("FAIL: string shift");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testShiftUnshift();
