function testMathBasic(): void {
  if (Math.abs(-5) !== 5) {
    console.log("FAIL: abs(-5)");
    process.exit(1);
  }
  if (Math.abs(3) !== 3) {
    console.log("FAIL: abs(3)");
    process.exit(1);
  }

  if (Math.max(3, 7) !== 7) {
    console.log("FAIL: max(3,7)");
    process.exit(1);
  }
  if (Math.min(3, 7) !== 3) {
    console.log("FAIL: min(3,7)");
    process.exit(1);
  }

  if (Math.floor(3.7) !== 3) {
    console.log("FAIL: floor(3.7)");
    process.exit(1);
  }
  if (Math.ceil(3.2) !== 4) {
    console.log("FAIL: ceil(3.2)");
    process.exit(1);
  }
  if (Math.round(3.5) !== 4) {
    console.log("FAIL: round(3.5)");
    process.exit(1);
  }
  if (Math.round(3.4) !== 3) {
    console.log("FAIL: round(3.4)");
    process.exit(1);
  }

  if (Math.sqrt(9) !== 3) {
    console.log("FAIL: sqrt(9)");
    process.exit(1);
  }
  if (Math.pow(2, 10) !== 1024) {
    console.log("FAIL: pow(2,10)");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testMathBasic();
