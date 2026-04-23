// Test basic string array - verifies string array creation and access
function testStringArray(): void {
  const arr = ["hello", "world", "test"];

  if (arr.length !== 3) {
    throw new Error("array length should be 3");
  }

  if (arr[0] !== "hello") {
    console.log("Error: first element should be 'hello'");
    process.exit(2);
  }

  if (arr[1] !== "world") {
    console.log("Error: second element should be 'world'");
    process.exit(3);
  }

  console.log("TEST_PASSED");
}

testStringArray();
