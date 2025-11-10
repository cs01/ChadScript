// Test basic Map operations
function testMap() {
  const m = new Map();
  m.set(1, 10);
  m.set(2, 20);
  m.set(3, 30);
  return m.get(2);
}

testMap();
