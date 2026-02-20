// Regression test: Array method results that return i32 should convert to double
// Tests that array.length (i32) works properly in multiplication

function test() {
  const arr = [10, 20, 30, 40, 50];

  // Array.length returns i32 but we need it as double for arithmetic
  const length = arr.length; // Returns 5
  const result = length * 4; // 5 * 4 = 20

  return result;
}

process.exit(test()); // Should exit with 20
