// @test-compile-error: enum declarations are not supported
// @test-description: numeric enums are a compile error
enum Direction {
  Up,
  Down,
  Left,
  Right,
}

console.log(Direction.Up);
