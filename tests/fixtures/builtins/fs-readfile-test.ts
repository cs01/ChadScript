// Test fs.readFileSync - verifies file reading works correctly
// Reads a known test file and verifies its content

function testReadFile(): number {
  // Read the test file
  const content = fs.readFileSync("tests/fixtures/builtins/test-file.txt");

  // Expected content
  const expected = "Hello from test file!\nThis is line 2.\nLine 3 here.";

  // Verify content matches
  if (content !== expected) {
    return 1; // Error: content doesn't match
  }

  // Verify length is correct (50 characters including newlines)
  if (content.length !== 50) {
    return 2; // Error: content length wrong
  }

  // Split by lines and verify we have 3 lines
  const lines = content.split("\n");
  if (lines.length !== 3) {
    return 3; // Error: should have 3 lines
  }

  // Verify first line
  if (lines[0] !== "Hello from test file!") {
    return 4; // Error: first line wrong
  }

  // Verify second line
  if (lines[1] !== "This is line 2.") {
    return 5; // Error: second line wrong
  }

  // Verify third line
  if (lines[2] !== "Line 3 here.") {
    return 6; // Error: third line wrong
  }

  // All checks passed!
  return 0;
}

process.exit(testReadFile());
