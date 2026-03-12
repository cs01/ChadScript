function testArrayFill(): void {
  const nums: number[] = [1, 2, 3, 4, 5];
  nums.fill(0);
  if (nums[0] !== 0 || nums[4] !== 0) {
    console.log("FAIL: fill all with 0");
    process.exit(1);
  }

  const nums2: number[] = [1, 2, 3, 4, 5];
  nums2.fill(9, 2);
  if (nums2[0] !== 1 || nums2[1] !== 2 || nums2[2] !== 9 || nums2[3] !== 9 || nums2[4] !== 9) {
    console.log("FAIL: fill from index 2");
    process.exit(1);
  }

  const nums3: number[] = [1, 2, 3, 4, 5];
  nums3.fill(7, 1, 3);
  if (nums3[0] !== 1 || nums3[1] !== 7 || nums3[2] !== 7 || nums3[3] !== 4 || nums3[4] !== 5) {
    console.log("FAIL: fill range 1-3");
    process.exit(1);
  }

  const strs: string[] = ["a", "b", "c"];
  strs.fill("x");
  if (strs[0] !== "x" || strs[1] !== "x" || strs[2] !== "x") {
    console.log("FAIL: fill strings");
    process.exit(1);
  }

  const strs2: string[] = ["a", "b", "c", "d"];
  strs2.fill("z", 1, 3);
  if (strs2[0] !== "a" || strs2[1] !== "z" || strs2[2] !== "z" || strs2[3] !== "d") {
    console.log("FAIL: fill strings with range");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testArrayFill();
