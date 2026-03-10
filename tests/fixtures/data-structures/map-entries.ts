function testMapEntries() {
  const m = new Map<string, string>();
  m.set("a", "1");
  m.set("b", "2");
  m.set("c", "3");

  let count = 0;
  let keys = "";
  let values = "";

  for (const [k, v] of m.entries()) {
    keys = keys + k;
    values = values + v;
    count = count + 1;
  }

  if (count !== 3) {
    console.log("FAIL: expected 3 entries, got " + count);
    return;
  }

  if (keys.length !== 3) {
    console.log("FAIL: expected 3 chars in keys");
    return;
  }

  if (values.length !== 3) {
    console.log("FAIL: expected 3 chars in values");
    return;
  }

  console.log("TEST_PASSED");
}

testMapEntries();
