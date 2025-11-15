// Test array.pop() - verifies pop removes and returns last element
function testArrayPop(): number {
  const arr = [10, 20, 30, 40, 50];

  // Pop should return the last element (50)
  const popped = arr.pop();
  if (popped !== 50) {
    throw new Error("pop() should return 50");
  }

  // Array length should now be 4
  if (arr.length !== 4) {
    throw new Error("array length should be 4 after pop");
  }

  console.log("TEST_PASSED");
}

testArrayPop();
