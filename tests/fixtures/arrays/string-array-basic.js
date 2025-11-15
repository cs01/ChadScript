// Test basic string array - verifies string array creation and access
function testStringArray(): number {
  const arr = ["hello", "world", "test"];

  if (arr.length !== 3) {
    console.log("Error: array length should be 3");
    process.exit(1);
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
  process.exit(0);
  return 0;
}

testStringArray();
