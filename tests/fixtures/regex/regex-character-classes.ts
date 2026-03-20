function testCharacterClasses(): void {
  const str = "hello 123 world";

  const digitMatch = str.match(/(\d+)/);
  if (digitMatch === null) {
    console.log("FAIL: \\d should match digits");
    process.exit(1);
  }
  if (digitMatch[0] !== "123") {
    console.log("FAIL: \\d match[0] expected 123, got " + digitMatch[0]);
    process.exit(1);
  }

  const wordMatch = str.match(/(\w+)/);
  if (wordMatch === null) {
    console.log("FAIL: \\w should match word chars");
    process.exit(1);
  }
  if (wordMatch[0] !== "hello") {
    console.log("FAIL: \\w match[0] expected hello, got " + wordMatch[0]);
    process.exit(1);
  }

  const spaceMatch = str.match(/(\s+)/);
  if (spaceMatch === null) {
    console.log("FAIL: \\s should match whitespace");
    process.exit(1);
  }
  if (spaceMatch[0] !== " ") {
    console.log("FAIL: \\s match[0] expected space, got '" + spaceMatch[0] + "'");
    process.exit(1);
  }

  const nonDigitMatch = str.match(/(\D+)/);
  if (nonDigitMatch === null || nonDigitMatch[0] !== "hello ") {
    console.log("FAIL: \\D should match non-digits");
    process.exit(1);
  }

  const nonWordMatch = str.match(/(\W+)/);
  if (nonWordMatch === null || nonWordMatch[0] !== " ") {
    console.log("FAIL: \\W should match non-word chars");
    process.exit(1);
  }

  const nonSpaceMatch = str.match(/(\S+)/);
  if (nonSpaceMatch === null || nonSpaceMatch[0] !== "hello") {
    console.log("FAIL: \\S should match non-space");
    process.exit(1);
  }

  if (!/\d{3}-\d{4}/.test("555-1234")) {
    console.log("FAIL: phone pattern should match");
    process.exit(1);
  }

  if (/\d+/.test("no digits here")) {
    console.log("FAIL: \\d should not match letters");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testCharacterClasses();
