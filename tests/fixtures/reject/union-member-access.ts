// @expect-reject: CS1239
// `.length` exists on both members, but a string's and an array's are read differently; narrow
// first.
function len(x: string | number[]): number {
  return x.length;
}
console.log(len("abc"));
