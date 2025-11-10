// Test basic Set operations
function testSet() {
  const s = new Set();
  s.add(10);
  s.add(20);
  s.add(30);
  return s.has(20);
}

testSet();
