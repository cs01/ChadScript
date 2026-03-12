function testReplaceAllEmpty(): void {
  const s = "hello";
  const result = s.replaceAll("", "x");
  if (result !== "hello") {
    console.log("FAIL: replaceAll with empty search should return original, got: " + result);
    process.exit(1);
  }

  const normal = "aabbcc".replaceAll("bb", "X");
  if (normal !== "aaXcc") {
    console.log("FAIL: normal replaceAll should work, got: " + normal);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testReplaceAllEmpty();
