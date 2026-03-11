function factorial(n: number): number {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}

function testRecursion(): void {
  if (factorial(0) !== 1) {
    console.log("FAIL: factorial(0)");
    process.exit(1);
  }

  if (factorial(1) !== 1) {
    console.log("FAIL: factorial(1)");
    process.exit(1);
  }

  if (factorial(5) !== 120) {
    console.log("FAIL: factorial(5) should be 120, got " + factorial(5));
    process.exit(1);
  }

  if (factorial(10) !== 3628800) {
    console.log("FAIL: factorial(10) should be 3628800, got " + factorial(10));
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testRecursion();
