// Test Map size property
function testMapSize() {
  const m = new Map();
  m.set(1, 100);
  m.set(2, 200);
  m.set(3, 300);
  return m.size;
}

testMapSize();
