function testStringMap() {
  const m = new Map<string, string>();
  m.set("hello", "world");
  m.set("foo", "bar");
  m.set("baz", "qux");

  if (m.size !== 3) {
    console.log("FAIL: size should be 3, got " + m.size);
    return;
  }

  const val = m.get("foo");
  if (val !== "bar") {
    console.log("FAIL: get('foo') should be 'bar', got " + val);
    return;
  }

  if (!m.has("hello")) {
    console.log("FAIL: has('hello') should be true");
    return;
  }

  if (m.has("missing")) {
    console.log("FAIL: has('missing') should be false");
    return;
  }

  m.delete("foo");
  if (m.has("foo")) {
    console.log("FAIL: has('foo') should be false after delete");
    return;
  }

  if (m.size !== 2) {
    console.log("FAIL: size should be 2 after delete");
    return;
  }

  m.clear();
  if (m.size !== 0) {
    console.log("FAIL: size should be 0 after clear");
    return;
  }

  console.log("TEST_PASSED");
}

testStringMap();
