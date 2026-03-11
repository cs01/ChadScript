function testForOfBreak(): void {
  const items: string[] = ["a", "b", "c", "d", "e"];
  let found: string = "";

  for (const item of items) {
    if (item === "c") {
      found = item;
      break;
    }
  }

  if (found !== "c") {
    console.log("FAIL: should have found c, got '" + found + "'");
    process.exit(1);
  }

  let count: number = 0;
  const nums: number[] = [1, 2, 3, 4, 5];
  for (const n of nums) {
    if (n > 3) {
      break;
    }
    count = count + 1;
  }

  if (count !== 3) {
    console.log("FAIL: count should be 3, got " + count);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testForOfBreak();
