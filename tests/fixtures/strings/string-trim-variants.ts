const padded = "  hello  ";

const trimmed = padded.trim();
if (trimmed !== "hello") {
  console.log("FAIL: trim got " + trimmed);
  process.exit(1);
}

const trimStart = padded.trimStart();
if (trimStart !== "hello  ") {
  console.log("FAIL: trimStart got '" + trimStart + "'");
  process.exit(1);
}

const trimEnd = padded.trimEnd();
if (trimEnd !== "  hello") {
  console.log("FAIL: trimEnd got '" + trimEnd + "'");
  process.exit(1);
}

const empty = "   ";
if (empty.trim() !== "") {
  console.log("FAIL: trim whitespace-only");
  process.exit(1);
}

console.log("TEST_PASSED");
