enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}

const d = Direction.Up;
if (d !== "UP") process.exit(1);
if (Direction.Down !== "DOWN") process.exit(1);
if (Direction.Left !== "LEFT") process.exit(1);
if (Direction.Right !== "RIGHT") process.exit(1);

function move(dir: string): string {
  if (dir === Direction.Up) return "moving up";
  if (dir === Direction.Down) return "moving down";
  return "moving sideways";
}

if (move(Direction.Up) !== "moving up") process.exit(1);
if (move(Direction.Down) !== "moving down") process.exit(1);
if (move(Direction.Left) !== "moving sideways") process.exit(1);

console.log("TEST_PASSED");
