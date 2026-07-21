// @test-compile-error: Spread arguments (...) in function calls are not yet supported
// @test-compile-error-native: expects at least 2 argument(s) but got 1
function sum(a: number, b: number): number {
  return a + b;
}
const args = [1, 2];
const result = sum(...args);
console.log(result);
