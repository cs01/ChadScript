// Test word counting with fs.readFileSync, string.split, and for loops
function testWordCount(): void {
  const content = fs.readFileSync("tests/fixtures/builtins/test-file.txt");
  const lines = content.split("\n");
  const lineCount = lines.length;

  // Should have 3 lines
  if (lineCount !== 3) {
    throw new Error("should have 3 lines");
  }

  // Count total words across all lines
  let wordCount = 0;
  for (let i = 0; i < lineCount; i = i + 1) {
    const line = lines[i];
    if (line.length > 0) {
      const words = line.split(" ");
      wordCount = wordCount + words.length;
    }
  }

  // Expected: "Hello from test file!" (4) + "This is line 2." (4) + "Line 3 here." (3) = 11 words
  if (wordCount !== 11) {
    throw new Error("should have 11 words");
  }

  console.log("TEST_PASSED");
}

testWordCount();
