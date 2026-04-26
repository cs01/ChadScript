// @test-compile-error: IIFE
function greet(): string {
  return "hello";
}
const result = (() => greet())();
console.log(result);
