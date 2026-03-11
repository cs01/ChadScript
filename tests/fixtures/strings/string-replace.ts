function testStringReplace(): void {
  const s: string = "hello world";
  const result: string = s.replace("world", "there");
  if (result !== "hello there") {
    console.log("FAIL: expected 'hello there', got '" + result + "'");
    process.exit(1);
  }

  const noMatch: string = s.replace("xyz", "abc");
  if (noMatch !== "hello world") {
    console.log("FAIL: no-match replace should return original");
    process.exit(1);
  }

  const empty: string = "".replace("a", "b");
  if (empty !== "") {
    console.log("FAIL: empty replace should return empty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringReplace();
