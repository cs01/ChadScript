// Test that arrays are properly zero-initialized
// This should not crash even when iterating over arrays

class ArrayTest {
  constructor() {
    this.items = [];
  }

  addItem(item) {
    this.items.push(item);
  }

  findItem(target) {
    // This mimics iteration and comparison - would crash if items contains garbage data
    let i = 0;
    while (i < this.items.length) {
      const current = this.items[i];
      // Comparison - would crash/return garbage if items contains uninitialized memory
      if (current === target) {
        return 1; // Found
      }
      i = i + 1;
    }
    return 0; // Not found
  }
}

function test() {
  const arr = new ArrayTest();

  // Add some items (using numbers to avoid string type inference bug)
  arr.addItem(100);
  arr.addItem(200);
  arr.addItem(300);

  // Try to find existing item
  const found = arr.findItem(200);

  // Try to find non-existing item (more iterations)
  const notFound = arr.findItem(999);

  // Return: found(1) * 10 + notFound(0) = 10
  return found * 10 + notFound;
}

process.exit(test());
