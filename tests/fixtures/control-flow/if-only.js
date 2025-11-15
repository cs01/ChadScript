// Test if without else - verifies absolute value function works
function abs(x: number): number {
  let result = x;
  if (x < 0) {
    result = 0 - x;
  }
  return result;
}

function testIfOnly(): number {
  const result = abs(0 - 42);
  if (result !== 42) {
    console.log("Error: abs(-42) should be 42");
    process.exit(1);
  }

  console.log("TEST_PASSED");
  process.exit(0);
  return 0;
}

testIfOnly();
