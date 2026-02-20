// Test basic Map operations
function testMap() {
  const m = new Map<number, number>();
  m.set(1, 10);
  m.set(2, 20);
  m.set(3, 30);
  const second = m.get(2);
  if (second === 20) {
    console.log("TEST_PASSED");
  }
}

testMap();
