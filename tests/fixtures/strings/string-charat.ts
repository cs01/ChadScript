function testCharAt(): void {
  const s = "Hello";

  if (s.charAt(0) !== "H") {
    console.log("FAIL: charAt(0)");
    process.exit(1);
  }
  if (s.charAt(4) !== "o") {
    console.log("FAIL: charAt(4)");
    process.exit(1);
  }

  const code = s.charCodeAt(0);
  if (code !== 72) {
    console.log("FAIL: charCodeAt(0) got " + code);
    process.exit(1);
  }
  const code2 = s.charCodeAt(1);
  if (code2 !== 101) {
    console.log("FAIL: charCodeAt(1) got " + code2);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testCharAt();
