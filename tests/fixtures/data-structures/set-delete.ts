function testSetDelete(): void {
  const s = new Set<number>();
  s.add(1);
  s.add(2);
  s.add(3);

  if (s.size !== 3) {
    console.log("FAIL: initial size");
    process.exit(1);
  }

  const deleted = s.delete(2);
  if (!deleted) {
    console.log("FAIL: delete should return true");
    process.exit(1);
  }

  if (s.size !== 2) {
    console.log("FAIL: size after delete");
    process.exit(1);
  }

  if (s.has(2)) {
    console.log("FAIL: should not have deleted element");
    process.exit(1);
  }

  if (!s.has(1)) {
    console.log("FAIL: should still have 1");
    process.exit(1);
  }

  if (!s.has(3)) {
    console.log("FAIL: should still have 3");
    process.exit(1);
  }

  const notDeleted = s.delete(99);
  if (notDeleted) {
    console.log("FAIL: delete non-existent should return false");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testSetDelete();
