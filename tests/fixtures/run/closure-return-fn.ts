function makeAdder(n: number): (x: number) => number {
  return (x: number): number => x + n;
}
const add5 = makeAdder(5);
const add10 = makeAdder(10);
console.log(add5(3));
console.log(add10(3));
