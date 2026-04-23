// @test-exit-code: 12
// Test object with more complex expressions
function calculate(a: number, b: number) {
  const point = { x: a * 2, y: b + 5 };
  return point.x - point.y;
}

process.exit(calculate(10, 3));
