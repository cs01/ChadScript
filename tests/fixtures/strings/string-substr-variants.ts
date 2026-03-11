function testSubstr(): void {
  const s: string = "Hello, World!";

  if (s.substr(0, 5) !== "Hello") {
    console.log("FAIL: substr(0,5) got '" + s.substr(0, 5) + "'");
    process.exit(1);
  }

  if (s.substr(7, 5) !== "World") {
    console.log("FAIL: substr(7,5) got '" + s.substr(7, 5) + "'");
    process.exit(1);
  }

  if (s.substr(7) !== "World!") {
    console.log("FAIL: substr(7) got '" + s.substr(7) + "'");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testSubstr();
