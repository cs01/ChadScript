// @test-description: closure captures variable with no post-capture mutation — valid
// Reassignment is fine as long as it happens BEFORE the closure is created.
// The checker only errors on reassignment AFTER capture.
function runTest(): void {
  let threshold = 3;
  threshold = 5; // reassigned before any closure captures it — no error
  const nums = [1, 2, 3, 4, 5, 6];
  const big = nums.filter((x) => x > threshold); // captures threshold (value 5)
  if (big.length === 1 && big[0] === 6) {
    console.log("TEST_PASSED");
  }
}
runTest();
