function testStringMap(): void {
  const m = new Map<string, string>();
  m.set("name", "alice");
  m.set("role", "admin");

  if (m.size !== 2) {
    console.log("FAIL: size should be 2, got " + m.size);
    process.exit(1);
  }

  const name: string = m.get("name");
  if (name !== "alice") {
    console.log("FAIL: name should be alice, got " + name);
    process.exit(1);
  }

  if (!m.has("role")) {
    console.log("FAIL: should have role");
    process.exit(1);
  }

  m.delete("role");
  if (m.size !== 1) {
    console.log("FAIL: size after delete should be 1, got " + m.size);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringMap();
