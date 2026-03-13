// @test-compile-error: variable 'sum' is captured by a closure but reassigned after capture
// @test-description: mutating a captured variable inside a closure is a compile error
let sum = 0;
const arr: number[] = [1, 2, 3];
arr.forEach((x: number): void => {
  sum = sum + x;
});
console.log(String(sum));
