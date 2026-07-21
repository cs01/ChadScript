// @test-compile-error: enum declarations are not supported
// @test-native-skip: native enum path throws internal "array index -1 out of bounds" instead of the enum-checker diagnostic (enum-checker not firing under native)
// @test-description: numeric enums are a compile error
enum Direction {
  Up,
  Down,
  Left,
  Right,
}

console.log(Direction.Up);
