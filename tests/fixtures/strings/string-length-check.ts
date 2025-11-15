// Test string length comparison - verifies empty string length is 0
function testStringLength(): void {
  const emptyStr = "";

  if (emptyStr.length !== 0) {
    throw new Error("empty string length should be 0");
  }

  console.log("TEST_PASSED");
}

testStringLength();
