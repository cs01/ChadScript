function testArraySort(): void {
  let nums: number[] = [5, 3, 8, 1, 4];
  nums.sort();

  if (nums[0] !== 1) {
    console.log("FAIL: first should be 1");
    process.exit(1);
  }
  if (nums[4] !== 8) {
    console.log("FAIL: last should be 8");
    process.exit(1);
  }

  let desc: number[] = [5, 3, 8, 1, 4];
  desc.sort((a: number, b: number): number => b - a);

  if (desc[0] !== 8) {
    console.log("FAIL: desc first should be 8");
    process.exit(1);
  }
  if (desc[4] !== 1) {
    console.log("FAIL: desc last should be 1");
    process.exit(1);
  }

  let strs: string[] = ["banana", "apple", "cherry"];
  strs.sort();

  if (strs[0] !== "apple") {
    console.log("FAIL: string sort first");
    process.exit(1);
  }
  if (strs[2] !== "cherry") {
    console.log("FAIL: string sort last");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testArraySort();
