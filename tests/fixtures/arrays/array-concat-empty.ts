function testConcatEmpty(): void {
  const a: number[] = [1, 2, 3];
  const empty: number[] = [];

  const r1 = a.concat(empty);
  if (r1.length !== 3) {
    console.log("FAIL: concat with empty should preserve length, got " + r1.length);
    process.exit(1);
  }
  if (r1[0] !== 1 || r1[2] !== 3) {
    console.log("FAIL: concat with empty values wrong");
    process.exit(1);
  }

  const r2 = empty.concat(a);
  if (r2.length !== 3) {
    console.log("FAIL: empty concat should have length 3, got " + r2.length);
    process.exit(1);
  }
  if (r2[0] !== 1 || r2[2] !== 3) {
    console.log("FAIL: empty concat values wrong");
    process.exit(1);
  }

  const r3 = empty.concat(empty);
  if (r3.length !== 0) {
    console.log("FAIL: empty concat empty should be 0, got " + r3.length);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testConcatEmpty();
