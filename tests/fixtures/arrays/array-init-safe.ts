// @test-exit-code: 10
// Test that arrays are properly zero-initialized with calloc
// This prevents crashes from garbage pointers during iteration

function test(): number {
  // Create array and push items - this triggers calloc
  const arr: number[] = [];
  arr.push(100);
  arr.push(200);
  arr.push(300);

  // Iterate and find item
  let i: number = 0;
  let found: number = 0;
  while (i < arr.length) {
    if (arr[i] === 200) {
      found = 1;
    }
    i = i + 1;
  }

  // Return: found(1) * 10 = 10
  return found * 10;
}

process.exit(test());
