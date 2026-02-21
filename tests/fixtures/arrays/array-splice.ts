function testArraySplice(): void {
  let nums: number[] = [1, 2, 3, 4, 5];
  let removed = nums.splice(1, 2);

  if (nums.length !== 3) {
    console.log("FAIL: length after splice");
    process.exit(1);
  }
  if (nums[0] !== 1) {
    console.log("FAIL: first element");
    process.exit(1);
  }
  if (nums[1] !== 4) {
    console.log("FAIL: second element after splice");
    process.exit(1);
  }
  if (nums[2] !== 5) {
    console.log("FAIL: third element after splice");
    process.exit(1);
  }

  if (removed.length !== 2) {
    console.log("FAIL: removed length");
    process.exit(1);
  }
  if (removed[0] !== 2) {
    console.log("FAIL: removed first");
    process.exit(1);
  }
  if (removed[1] !== 3) {
    console.log("FAIL: removed second");
    process.exit(1);
  }

  let strs: string[] = ["a", "b", "c", "d"];
  let removedStrs = strs.splice(0, 1);

  if (strs.length !== 3) {
    console.log("FAIL: string splice length");
    process.exit(1);
  }
  if (strs[0] !== "b") {
    console.log("FAIL: string splice first");
    process.exit(1);
  }
  if (removedStrs[0] !== "a") {
    console.log("FAIL: removed string");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testArraySplice();
