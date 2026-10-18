// @expect-reject: CS1000
function f(a: number, b?: number): number {
  return arguments.length + a + (b ?? 0);
}
console.log(f(1));
