// Multiplication and subtraction
function multiply(a, b) {
  return a * b;
}

function calculate(x, y) {
  return multiply(x, y) - 3;
}

// Verify result and report
const result = calculate(4, 5);
if (result === 17) {
  console.log("TEST_PASSED");
} else {
  console.log("TEST_FAILED");
}
