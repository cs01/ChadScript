// @test-exit-code: 12
// Test object method call
function add(a: number, b: number) {
  return a + b;
}

function testMethod() {
  const obj = { add: 0 };
  return obj.add(5, 7);
}

process.exit(testMethod());
