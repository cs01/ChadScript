// String enums map members to string literal values
enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}

const dir: string = Direction.Up;
if (dir === "UP") {
  console.log("TEST_PASSED");
}
