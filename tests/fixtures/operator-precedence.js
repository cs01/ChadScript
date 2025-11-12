// Test: Operator precedence (multiplication before addition)
function compute(a, b, c) {
  return a + b * c;
}

process.exit(compute(2, 3, 4));
