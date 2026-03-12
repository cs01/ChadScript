function testStringConcat(): void {
  const a: string[] = ["hello", "world"];
  const b: string[] = ["foo", "bar", "baz"];
  const c = a.concat(b);
  if (c.length !== 5) {
    console.log("FAIL: concat length should be 5, got " + c.length);
    process.exit(1);
  }
  if (c[0] !== "hello" || c[2] !== "foo" || c[4] !== "baz") {
    console.log("FAIL: concat values wrong");
    process.exit(1);
  }

  if (a.length !== 2 || b.length !== 3) {
    console.log("FAIL: original arrays should not be modified");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringConcat();
