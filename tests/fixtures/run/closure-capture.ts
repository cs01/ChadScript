const factor = 10;
const scale = (x: number): number => x * factor;
console.log(scale(3));
console.log(scale(7));
const base = 100;
const offset = 5;
const compute = (x: number): number => x * base + offset;
console.log(compute(2));
