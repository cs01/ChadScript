// @test-compile-error: Rest parameters (...rest) are not yet supported
// @test-compile-error-native: expects at most 2 argument(s) but got 3
function first(a: number, ...rest: number[]): number {
  return a;
}
console.log(first(1, 2, 3));
