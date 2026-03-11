function testClosureCapture(): void {
  const prefix: string = "item-";
  const nums: number[] = [1, 2, 3, 4, 5];

  const sum: number = nums.reduce((acc: number, val: number): number => {
    return acc + val;
  }, 0);

  if (sum !== 15) {
    console.log("FAIL: sum should be 15, got " + sum);
    process.exit(1);
  }

  const strs: string[] = ["a", "b", "c"];
  const filtered: string[] = strs.filter((s: string): boolean => {
    return s !== "b";
  });

  if (filtered.length !== 2) {
    console.log("FAIL: filtered length should be 2, got " + filtered.length);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testClosureCapture();
