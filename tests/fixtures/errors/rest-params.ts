// @test-compile-error: Rest parameters (...rest) are not yet supported
function first(a: number, ...rest: number[]): number {
  return a;
}
console.log(first(1, 2, 3));
