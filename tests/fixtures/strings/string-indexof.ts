function testStringIndexOf(): void {
  const s: string = "hello world";

  const idx: number = s.indexOf("world");
  if (idx !== 6) {
    console.log("FAIL: indexOf world should be 6, got " + idx);
    process.exit(1);
  }

  const first: number = s.indexOf("l");
  if (first !== 2) {
    console.log("FAIL: indexOf l should be 2, got " + first);
    process.exit(1);
  }

  const notFound: number = s.indexOf("xyz");
  if (notFound !== -1) {
    console.log("FAIL: indexOf xyz should be -1, got " + notFound);
    process.exit(1);
  }

  const empty: number = "".indexOf("a");
  if (empty !== -1) {
    console.log("FAIL: empty indexOf should be -1, got " + empty);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringIndexOf();
