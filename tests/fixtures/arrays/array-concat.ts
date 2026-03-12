function testNumericConcat(): void {
  const a: number[] = [1, 2, 3];
  const b: number[] = [4, 5, 6];
  const c = a.concat(b);
  if (c.length !== 6) {
    console.log("FAIL: concat length should be 6, got " + c.length);
    process.exit(1);
  }
  if (c[0] !== 1 || c[3] !== 4 || c[5] !== 6) {
    console.log("FAIL: concat values wrong");
    process.exit(1);
  }

  if (a.length !== 3 || b.length !== 3) {
    console.log("FAIL: original arrays should not be modified");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testNumericConcat();
