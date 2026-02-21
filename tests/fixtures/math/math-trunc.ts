function testMathTrunc(): void {
  if (Math.trunc(3.7) !== 3) {
    console.log("FAIL: trunc(3.7)");
    process.exit(1);
  }
  if (Math.trunc(-3.7) !== -3) {
    console.log("FAIL: trunc(-3.7)");
    process.exit(1);
  }
  if (Math.trunc(0.9) !== 0) {
    console.log("FAIL: trunc(0.9)");
    process.exit(1);
  }
  if (Math.trunc(-0.9) !== 0) {
    console.log("FAIL: trunc(-0.9)");
    process.exit(1);
  }
  if (Math.trunc(42) !== 42) {
    console.log("FAIL: trunc(42)");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
testMathTrunc();
