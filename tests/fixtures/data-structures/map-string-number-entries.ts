function testMapStringNumberEntries() {
  const m = new Map<string, number>();
  m.set("a", 10);
  m.set("b", 20);
  m.set("c", 30);

  let count = 0;
  let allKeys = "";

  for (const [k, v] of m.entries()) {
    allKeys = allKeys + k;
    count = count + 1;
  }

  if (count !== 3) {
    console.log("FAIL: expected 3 entries, got " + count);
    return;
  }

  if (allKeys.length !== 3) {
    console.log("FAIL: expected 3 chars in keys");
    return;
  }

  console.log("TEST_PASSED");
}

testMapStringNumberEntries();
