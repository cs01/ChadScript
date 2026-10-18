// @expect-reject: CS1000
function fl(a: number, b = 2): number {
  return a + b;
}
console.log(fl.length);
