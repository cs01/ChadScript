function add(a: number, b: number): number {
  return a + b;
}
function apply(fn: (a: number, b: number) => number, x: number, y: number): number {
  return fn(x, y);
}
console.log(apply(add, 2, 3));
const ops: ((a: number, b: number) => number)[] = [add];
for (const op of ops) {
  console.log(op(10, 5));
}
console.log([1, 2, 3].reduce(add, 0));
