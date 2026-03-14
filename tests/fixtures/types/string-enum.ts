// @test-compile-error: enum declarations are not supported
// @test-description: string enums are a compile error
enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}

console.log(Direction.Up);
