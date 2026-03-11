function testSubstring(): void {
  const s: string = "Hello, World!";

  if (s.substring(0, 5) !== "Hello") {
    console.log("FAIL: substring(0,5) got '" + s.substring(0, 5) + "'");
    process.exit(1);
  }

  if (s.substring(7) !== "World!") {
    console.log("FAIL: substring(7) got '" + s.substring(7) + "'");
    process.exit(1);
  }

  if (s.substring(7, 12) !== "World") {
    console.log("FAIL: substring(7,12) got '" + s.substring(7, 12) + "'");
    process.exit(1);
  }

  const empty: string = "test";
  if (empty.substring(2, 2) !== "") {
    console.log("FAIL: substring(2,2) should be empty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testSubstring();
