function testRegExpConstructor(): void {
  const re1 = new RegExp("^hello");
  if (!re1.test("hello world")) {
    console.log("FAIL: re1 should match");
    process.exit(1);
  }
  if (re1.test("world hello")) {
    console.log("FAIL: re1 should not match");
    process.exit(1);
  }

  const re2 = new RegExp("HELLO", "i");
  if (!re2.test("hello")) {
    console.log("FAIL: re2 case-insensitive should match");
    process.exit(1);
  }

  const re3 = new RegExp("^world", "m");
  if (!re3.test("hello\nworld")) {
    console.log("FAIL: re3 multiline should match");
    process.exit(1);
  }

  const pattern = "foo[0-9]+";
  const re4 = new RegExp(pattern);
  if (!re4.test("foo123")) {
    console.log("FAIL: re4 dynamic pattern should match");
    process.exit(1);
  }
  if (re4.test("bar")) {
    console.log("FAIL: re4 should not match bar");
    process.exit(1);
  }

  const re5 = new RegExp("[A-Z]+", "i");
  if (!re5.test("abc")) {
    console.log("FAIL: re5 case-insensitive dynamic should match");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testRegExpConstructor();
