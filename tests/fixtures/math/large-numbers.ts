function testLargeNumbers(): void {
  const a = 50000000;
  const b = 100000000;
  const c = 2000000000;

  if (a !== 50000000) {
    console.log("FAIL: 50000000");
    process.exit(1);
  }

  if (b !== 100000000) {
    console.log("FAIL: 100000000");
    process.exit(1);
  }

  if (c !== 2000000000) {
    console.log("FAIL: 2000000000");
    process.exit(1);
  }

  const big = 3000000000;
  if (big !== 3000000000) {
    console.log("FAIL: 3000000000");
    process.exit(1);
  }

  const sum = a + b;
  if (sum !== 150000000) {
    console.log("FAIL: sum");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testLargeNumbers();
