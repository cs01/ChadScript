function testArrayDestructure(): void {
  const nums: number[] = [100, 200, 300];
  const [a, b, c] = nums;

  if (a !== 100) {
    console.log("FAIL: a should be 100");
    process.exit(1);
  }

  if (b !== 200) {
    console.log("FAIL: b should be 200");
    process.exit(1);
  }

  if (c !== 300) {
    console.log("FAIL: c should be 300");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testArrayDestructure();
