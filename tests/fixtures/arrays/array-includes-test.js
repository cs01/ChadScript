// Test array.includes() - verifies includes method works correctly
function testArrayIncludes(): number {
  const arr = [10, 20, 30, 40, 50];

  // Test that includes returns 1 for existing element
  if (arr.includes(30) !== 1) {
    console.log("Error: includes(30) should return 1");
    process.exit(1);
  }

  // Test that includes returns 0 for non-existent element
  if (arr.includes(99) !== 0) {
    console.log("Error: includes(99) should return 0");
    process.exit(2);
  }

  console.log("TEST_PASSED");
  process.exit(0);
  return 0;
}

testArrayIncludes();
