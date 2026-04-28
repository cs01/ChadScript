enum Color {
  Red,
  Green,
  Blue,
}

console.log(Color.Red);
console.log(Color.Green);
console.log(Color.Blue);

enum Status {
  Active = 1,
  Inactive = 2,
  Pending = 10,
}

console.log(Status.Active);
console.log(Status.Inactive);
console.log(Status.Pending);

const c: Color = Color.Green;
console.log(c === Color.Green);
console.log(c === Color.Red);

enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}

console.log(Direction.Up);
console.log(Direction.Left);
