function testArrayIndexOf(): void {
  let nums: number[] = [10, 20, 30, 40, 50];

  if (nums.indexOf(30) !== 2) {
    console.log("FAIL: found element");
    process.exit(1);
  }

  if (nums.indexOf(99) !== -1) {
    console.log("FAIL: not found");
    process.exit(1);
  }

  if (nums.indexOf(10) !== 0) {
    console.log("FAIL: first element");
    process.exit(1);
  }

  // fromIndex tests for number arrays
  if (nums.indexOf(30, 3) !== -1) {
    console.log("FAIL: fromIndex past element");
    process.exit(1);
  }

  if (nums.indexOf(30, 2) !== 2) {
    console.log("FAIL: fromIndex at element");
    process.exit(1);
  }

  if (nums.indexOf(50, 4) !== 4) {
    console.log("FAIL: fromIndex at last");
    process.exit(1);
  }

  let strs: string[] = ["hello", "world", "foo"];

  if (strs.indexOf("world") !== 1) {
    console.log("FAIL: string found");
    process.exit(1);
  }

  if (strs.indexOf("bar") !== -1) {
    console.log("FAIL: string not found");
    process.exit(1);
  }

  // fromIndex tests for string arrays
  if (strs.indexOf("hello", 1) !== -1) {
    console.log("FAIL: string fromIndex past element");
    process.exit(1);
  }

  if (strs.indexOf("foo", 2) !== 2) {
    console.log("FAIL: string fromIndex at element");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testArrayIndexOf();
