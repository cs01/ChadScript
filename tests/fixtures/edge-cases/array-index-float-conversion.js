// Regression test: Array indexing with float values should convert to int
// This tests fptosi double to i32 conversion for array access

function test() {
  const arr = [10, 20, 30, 40, 50];

  // Float index should truncate to integer
  const index = 2.7; // Should access arr[2] = 30
  const value = arr[index];

  return value;
}

process.exit(test()); // Should exit with 30
