// Regression test: Array.length in comparisons (i32 to double conversion)
// This tests that length values work correctly in conditionals

function test() {
  const arr1 = [1, 2, 3];
  const arr2 = [4, 5, 6, 7, 8];

  // Array lengths must convert from i32 to double for comparison
  if (arr2.length > arr1.length) {
    return 42; // arr2 has 5 elements, arr1 has 3
  }

  return 0;
}

process.exit(test()); // Should exit with 42
