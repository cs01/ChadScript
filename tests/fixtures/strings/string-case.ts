function testStringCase(): void {
  const s = "Hello World";

  const lower = s.toLowerCase();
  if (lower !== "hello world") {
    console.log("FAIL: toLowerCase got " + lower);
    process.exit(1);
  }

  const upper = s.toUpperCase();
  if (upper !== "HELLO WORLD") {
    console.log("FAIL: toUpperCase got " + upper);
    process.exit(1);
  }

  const mixed = "aBcDeFg";
  if (mixed.toLowerCase() !== "abcdefg") {
    console.log("FAIL: mixed toLowerCase");
    process.exit(1);
  }
  if (mixed.toUpperCase() !== "ABCDEFG") {
    console.log("FAIL: mixed toUpperCase");
    process.exit(1);
  }

  const empty = "";
  if (empty.toLowerCase() !== "") {
    console.log("FAIL: empty toLowerCase");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testStringCase();
