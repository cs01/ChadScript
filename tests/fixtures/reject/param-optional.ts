// @expect-reject: CS1217
function f(x?: number): number {
  return x ?? 0;
}
console.log(f());
