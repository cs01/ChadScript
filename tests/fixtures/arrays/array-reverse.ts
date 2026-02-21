function testArrayReverse(): void {
  let nums: number[] = [1, 2, 3, 4, 5];
  nums.reverse();

  if (nums[0] !== 5) {
    console.log("FAIL: first element");
    process.exit(1);
  }
  if (nums[4] !== 1) {
    console.log("FAIL: last element");
    process.exit(1);
  }
  if (nums.length !== 5) {
    console.log("FAIL: length changed");
    process.exit(1);
  }

  let strs: string[] = ["a", "b", "c"];
  strs.reverse();

  if (strs[0] !== "c") {
    console.log("FAIL: string first");
    process.exit(1);
  }
  if (strs[2] !== "a") {
    console.log("FAIL: string last");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testArrayReverse();
