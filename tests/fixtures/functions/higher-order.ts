function apply(fn: (x: number) => number, val: number): number {
  return fn(val);
}

function compose(f: (x: number) => number, g: (x: number) => number, val: number): number {
  return f(g(val));
}

const double = (x: number): number => x * 2;
const addOne = (x: number): number => x + 1;

console.log(apply(double, 5));
console.log(apply(addOne, 10));
console.log(compose(double, addOne, 3));
console.log(compose(addOne, double, 3));

function makeAdder(x: number): (y: number) => number {
  const add = (y: number): number => x + y;
  return add;
}
const add10 = makeAdder(10);
console.log(apply(add10, 5));
