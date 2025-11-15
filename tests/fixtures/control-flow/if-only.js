// Test if without else - verifies absolute value function works
function abs(x: number): void {
  let result = x;
  if (x < 0) {
    result = 0 - x;
  }
  return result;
}

function testIfOnly(): void {
  const result = abs(0 - 42);
  if (result !== 42) {
    throw new Error("abs(-42) should be 42");
  }

  console.log("TEST_PASSED");
}

testIfOnly();
