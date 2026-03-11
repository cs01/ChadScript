function testCharCodeAt(): void {
  const s: string = "ABC";

  if (s.charCodeAt(0) !== 65) {
    console.log("FAIL: charCodeAt(0) should be 65, got " + s.charCodeAt(0));
    process.exit(1);
  }

  if (s.charCodeAt(1) !== 66) {
    console.log("FAIL: charCodeAt(1) should be 66, got " + s.charCodeAt(1));
    process.exit(1);
  }

  if (s.charCodeAt(2) !== 67) {
    console.log("FAIL: charCodeAt(2) should be 67, got " + s.charCodeAt(2));
    process.exit(1);
  }

  const lower: string = "abc";
  if (lower.charCodeAt(0) !== 97) {
    console.log("FAIL: 'a' charCodeAt should be 97, got " + lower.charCodeAt(0));
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testCharCodeAt();
