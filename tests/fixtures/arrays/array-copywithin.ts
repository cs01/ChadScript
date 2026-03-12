function testCopyWithin(): void {
  const nums: number[] = [1, 2, 3, 4, 5];
  nums.copyWithin(0, 3);
  if (nums[0] !== 4) {
    console.log("FAIL: expected nums[0]=4 got " + nums[0]);
    process.exit(1);
  }
  if (nums[1] !== 5) {
    console.log("FAIL: expected nums[1]=5 got " + nums[1]);
    process.exit(1);
  }
  if (nums[2] !== 3) {
    console.log("FAIL: expected nums[2]=3 got " + nums[2]);
    process.exit(1);
  }

  const nums2: number[] = [1, 2, 3, 4, 5];
  nums2.copyWithin(1, 3, 4);
  if (nums2[0] !== 1) {
    console.log("FAIL: expected nums2[0]=1 got " + nums2[0]);
    process.exit(1);
  }
  if (nums2[1] !== 4) {
    console.log("FAIL: expected nums2[1]=4 got " + nums2[1]);
    process.exit(1);
  }
  if (nums2[2] !== 3) {
    console.log("FAIL: expected nums2[2]=3 got " + nums2[2]);
    process.exit(1);
  }

  const strs: string[] = ["a", "b", "c", "d", "e"];
  strs.copyWithin(0, 3);
  if (strs[0] !== "d") {
    console.log("FAIL: expected strs[0]='d' got '" + strs[0] + "'");
    process.exit(1);
  }
  if (strs[1] !== "e") {
    console.log("FAIL: expected strs[1]='e' got '" + strs[1] + "'");
    process.exit(1);
  }

  const nums3: number[] = [1, 2, 3, 4, 5];
  nums3.copyWithin(1, 0, 2);
  if (nums3[1] !== 1) {
    console.log("FAIL: expected nums3[1]=1 got " + nums3[1]);
    process.exit(1);
  }
  if (nums3[2] !== 2) {
    console.log("FAIL: expected nums3[2]=2 got " + nums3[2]);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testCopyWithin();
