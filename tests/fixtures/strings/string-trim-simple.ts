// Test string.trim() - verifies trim removes leading and trailing whitespace
function testStringTrim(): void {
  const s = "  hello  ";
  const trimmed = s.trim();

  // Verify trimmed result is "hello"
  if (trimmed !== "hello") {
    console.log("Error: trim() should return 'hello'");
    process.exit(1);
  }

  // Verify length is correct (5 characters)
  if (trimmed.length !== 5) {
    throw new Error("trimmed length should be 5");
  }

  console.log("TEST_PASSED");
}

testStringTrim();
