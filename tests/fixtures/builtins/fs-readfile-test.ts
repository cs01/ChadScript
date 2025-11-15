// Test fs.readFileSync - verifies file reading works correctly
// Reads a known test file and verifies its content

function testReadFile(): number {
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
    console.log("Error: content length wrong");
    process.exit(2);
  }

  // Split by lines and verify we have 3 lines
  const lines = content.split("\n");
  if (lines.length !== 3) {
    console.log("Error: should have 3 lines");
    process.exit(3);
  }

  // Verify first line
  if (lines[0] !== "Hello from test file!") {
    console.log("Error: first line wrong");
    process.exit(4);
  }

  // Verify second line
  if (lines[1] !== "This is line 2.") {
    console.log("Error: second line wrong");
    process.exit(5);
  }

  // Verify third line
  if (lines[2] !== "Line 3 here.") {
    console.log("Error: third line wrong");
    process.exit(6);
  }

  // All checks passed!
  console.log("TEST_PASSED");
  process.exit(0);
  return 0; // Never reached but satisfies compiler
}

testReadFile();
