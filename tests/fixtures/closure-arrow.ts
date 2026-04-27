function makeMultiplier(factor: number): (x: number) => number {
  return (x: number): number => factor * x;
}

const double = makeMultiplier(2);
const triple = makeMultiplier(3);
console.log(double(5));
console.log(triple(5));
console.log(double(7));
console.log(triple(7));
