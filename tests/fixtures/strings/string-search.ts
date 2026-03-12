function testSearch(): void {
  const str = "hello world";

  const idx = str.search(/world/);
  if (idx !== 6) {
    console.log("FAIL: expected 6 got " + idx);
    process.exit(1);
  }

  const noMatch = str.search(/xyz/);
  if (noMatch !== -1) {
    console.log("FAIL: expected -1 got " + noMatch);
    process.exit(1);
  }

  const caseInsensitive = str.search(/HELLO/i);
  if (caseInsensitive !== 0) {
    console.log("FAIL: case insensitive expected 0 got " + caseInsensitive);
    process.exit(1);
  }

  const digitStr = "abc123def";
  const digitIdx = digitStr.search(/[0-9]+/);
  if (digitIdx !== 3) {
    console.log("FAIL: digit expected 3 got " + digitIdx);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testSearch();
