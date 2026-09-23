// @known-bug: phase 4 (Value): number | string is rejected (CS1233)
let x: number | string = 3;
console.log(typeof x, x);
x = "hi";
console.log(typeof x, x);
