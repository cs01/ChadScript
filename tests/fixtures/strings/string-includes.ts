function testStringIncludes(): void {
  const s: string = "Hello, World!";

  if (!s.includes("World")) {
    console.log("FAIL: should include 'World'");
    process.exit(1);
  }

  if (!s.includes("Hello")) {
    console.log("FAIL: should include 'Hello'");
    process.exit(1);
  }

  if (s.includes("xyz")) {
    console.log("FAIL: should not include 'xyz'");
    process.exit(1);
  }

  if (!s.includes("")) {
    console.log("FAIL: should include empty string");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringIncludes();
