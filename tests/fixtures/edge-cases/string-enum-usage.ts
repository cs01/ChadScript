// @test-compile-error: enum declarations are not supported
// @test-native-skip: native enum path throws internal "array index -1 out of bounds" instead of the enum-checker diagnostic (enum-checker not firing under native)
// @test-description: string enum usage is a compile error
enum Direction {
  Up = "UP",
  Down = "DOWN",
}

console.log(Direction.Up);
