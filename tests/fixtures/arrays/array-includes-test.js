// Test array.includes() - verifies includes method works correctly
function testArrayIncludes(): void {
  const arr = [10, 20, 30, 40, 50];

  // Test that includes returns 1 for existing element
  if (arr.includes(30) !== 1) {
    throw new Error("includes(30) should return 1");
  }

  // Test that includes returns 0 for non-existent element
  if (arr.includes(99) !== 0) {
    throw new Error("includes(99) should return 0");
  }

  console.log("TEST_PASSED");
}

testArrayIncludes();
