// @expect-reject: CS1217
// Called through `(x: number) => number`, the closure would never receive `y`.
function twice(f: (x: number) => number): number {
  return f(f(1));
}
console.log(twice((x, y = 1) => x + y));
