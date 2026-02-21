function testMathSign(): void {
  if (Math.sign(5) !== 1) {
    console.log("FAIL: sign(5)");
    process.exit(1);
  }
  if (Math.sign(-5) !== -1) {
    console.log("FAIL: sign(-5)");
    process.exit(1);
  }
  if (Math.sign(0) !== 0) {
    console.log("FAIL: sign(0)");
    process.exit(1);
  }
  if (Math.sign(100.5) !== 1) {
    console.log("FAIL: sign(100.5)");
    process.exit(1);
  }
  if (Math.sign(-0.001) !== -1) {
    console.log("FAIL: sign(-0.001)");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
testMathSign();
