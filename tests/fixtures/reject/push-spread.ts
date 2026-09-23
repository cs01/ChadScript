// @expect-reject: CS1000
const a: number[] = [1];
const b: number[] = [2, 3];
a.push(...b);
console.log(a);
