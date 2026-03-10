function testMapKeys() {
  const m = new Map<string, string>();
  m.set("hello", "world");
  m.set("foo", "bar");

  const keys = m.keys();
  let count = 0;
  for (const k of keys) {
    count = count + 1;
  }

  if (count !== 2) {
    console.log("FAIL: expected 2 keys, got " + count);
    return;
  }

  console.log("TEST_PASSED");
}

testMapKeys();
