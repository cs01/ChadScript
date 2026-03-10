function testStringNumberMap() {
  const m = new Map<string, number>();
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3);

  if (m.size !== 3) {
    console.log("FAIL: size should be 3");
    return;
  }

  const val = m.get("b");
  if (val !== 2) {
    console.log("FAIL: get('b') should be 2");
    return;
  }

  if (!m.has("a")) {
    console.log("FAIL: has('a') should be true");
    return;
  }

  m.delete("c");
  if (m.size !== 2) {
    console.log("FAIL: size should be 2 after delete");
    return;
  }

  console.log("TEST_PASSED");
}

testStringNumberMap();
