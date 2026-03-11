enum Direction {
  Up,
  Down,
  Left,
  Right,
}

function testNumericEnum(): void {
  const d: number = Direction.Up;
  if (d !== 0) {
    console.log("FAIL: Up should be 0, got " + d);
    process.exit(1);
  }

  if (Direction.Down !== 1) {
    console.log("FAIL: Down should be 1");
    process.exit(1);
  }

  if (Direction.Right !== 3) {
    console.log("FAIL: Right should be 3");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testNumericEnum();
