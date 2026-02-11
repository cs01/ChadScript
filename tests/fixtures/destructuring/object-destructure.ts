interface Point {
  x: number;
  y: number;
}

function testObjectDestructure(): void {
  const point: Point = { x: 10, y: 20 };
  const { x, y } = point;

  if (x !== 10) {
    console.log("FAIL: x should be 10");
    process.exit(1);
  }

  if (y !== 20) {
    console.log("FAIL: y should be 20");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testObjectDestructure();
