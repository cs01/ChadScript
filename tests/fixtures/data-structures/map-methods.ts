function testMapMethods() {
  const m = new Map<number, number>();
  m.set(1, 10);
  m.set(2, 20);
  m.set(3, 30);

  if (m.size !== 3) {
    console.log("FAIL: size should be 3, got " + m.size);
    return;
  }

  if (!m.has(2)) {
    console.log("FAIL: has(2) should be true");
    return;
  }

  if (m.has(99)) {
    console.log("FAIL: has(99) should be false");
    return;
  }

  m.delete(2);
  if (m.has(2)) {
    console.log("FAIL: has(2) should be false after delete");
    return;
  }

  if (m.size !== 2) {
    console.log("FAIL: size should be 2 after delete, got " + m.size);
    return;
  }

  m.clear();
  if (m.size !== 0) {
    console.log("FAIL: size should be 0 after clear, got " + m.size);
    return;
  }

  console.log("TEST_PASSED");
}

testMapMethods();
