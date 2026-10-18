// @expect-reject: CS1217
function g(x?: undefined): number {
  return x === undefined ? 1 : 0;
}
console.log(g());
