// Test fs.readFileSync - verifies file reading works correctly
// Reads a known test file and verifies its content

function testReadFile(): void {
  // Read the test file
  const content = fs.readFileSync("tests/fixtures/builtins/test-file.txt");

  // Expected content
  const expected = "Hello from test file!\nThis is line 2.\nLine 3 here.";

  // Verify content matches
  if (content !== expected) {
    console.log("Error: content doesn't match");
    process.exit(1);
  }

  // Verify length is correct (50 characters including newlines)
  if (content.length !== 50) {
    throw new Error("content length wrong");
  }

  // Split by lines and verify we have 3 lines
  const lines = content.split("\n");
  if (lines.length !== 3) {
    throw new Error("should have 3 lines");
  }

  // Verify first line
  if (lines[0] !== "Hello from test file!") {
    throw new Error("first line wrong");
  }

  // Verify second line
  if (lines[1] !== "This is line 2.") {
    throw new Error("second line wrong");
  }

  // Verify third line
  if (lines[2] !== "Line 3 here.") {
    throw new Error("third line wrong");
  }

  // All checks passed!
  console.log("TEST_PASSED");
}

testReadFile();
