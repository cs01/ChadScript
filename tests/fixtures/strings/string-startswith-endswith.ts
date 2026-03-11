function testStartsEndsWith(): void {
  const s = "Hello World";

  if (!s.startsWith("Hello")) {
    console.log("FAIL: startsWith Hello");
    process.exit(1);
  }
  if (s.startsWith("World")) {
    console.log("FAIL: should not startsWith World");
    process.exit(1);
  }

  if (!s.endsWith("World")) {
    console.log("FAIL: endsWith World");
    process.exit(1);
  }
  if (s.endsWith("Hello")) {
    console.log("FAIL: should not endsWith Hello");
    process.exit(1);
  }

  const empty = "";
  if (!empty.startsWith("")) {
    console.log("FAIL: empty startsWith empty");
    process.exit(1);
  }
  if (!empty.endsWith("")) {
    console.log("FAIL: empty endsWith empty");
    process.exit(1);
  }

  if (!s.startsWith("")) {
    console.log("FAIL: any startsWith empty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testStartsEndsWith();
