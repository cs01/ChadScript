// @expect-reject: CS1204
let a: number | undefined = 1;
a! = 2;
console.log(a);
