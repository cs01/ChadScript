// @test-exit-code: 30
// Test object literal and property access
function testObject() {
  const obj = { x: 10, y: 20 };
  return obj.x + obj.y;
}

process.exit(testObject());
