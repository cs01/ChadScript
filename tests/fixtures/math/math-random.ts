function testMathRandom(): void {
  const r1 = Math.random();
  const r2 = Math.random();
  const r3 = Math.random();

  if (r1 < 0 || r1 >= 1) {
    console.log("FAIL: random() out of range");
    process.exit(1);
  }
  if (r2 < 0 || r2 >= 1) {
    console.log("FAIL: random() out of range");
    process.exit(1);
  }
  if (r3 < 0 || r3 >= 1) {
    console.log("FAIL: random() out of range");
    process.exit(1);
  }

  if (r1 === r2 && r2 === r3) {
    console.log("FAIL: all random values identical");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testMathRandom();
