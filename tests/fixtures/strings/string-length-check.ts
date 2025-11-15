// Test string length comparison - verifies empty string length is 0
function testStringLength(): number {
  const emptyStr = "";

  if (emptyStr.length !== 0) {
    console.log("Error: empty string length should be 0");
    process.exit(1);
  }

  console.log("TEST_PASSED");
  process.exit(0);
  return 0;
}

testStringLength();
