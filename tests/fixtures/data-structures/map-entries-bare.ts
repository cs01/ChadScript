function testMapEntriesBare() {
  const m = new Map<string, string>();
  m.set("one", "1");
  m.set("two", "2");

  let count = 0;
  for (const [k, v] of m) {
    count = count + 1;
  }

  if (count !== 2) {
    console.log("FAIL: expected 2 entries from bare map, got " + count);
    return;
  }

  console.log("TEST_PASSED");
}

testMapEntriesBare();
