// Test: Nested function calls
function multiply(a, b) {
  return a * b;
}

function calculate(x, y) {
  return multiply(x, y) - 3;
}

calculate(4, 5);
