function testStringSet(): void {
  const s = new Set<string>();
  s.add("hello");
  s.add("world");
  s.add("hello");

  if (s.size !== 2) {
    console.log("FAIL: size should be 2, got " + s.size);
    process.exit(1);
  }

  if (!s.has("hello")) {
    console.log("FAIL: should have hello");
    process.exit(1);
  }

  if (s.has("missing")) {
    console.log("FAIL: should not have missing");
    process.exit(1);
  }

  s.delete("world");
  if (s.size !== 1) {
    console.log("FAIL: size after delete should be 1, got " + s.size);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringSet();
