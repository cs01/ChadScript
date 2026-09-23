// @expect-reject: CS1238
// %o shows a function's length, name and prototype.
function add(a: number): number {
  return a + 1;
}
console.log("%o", { f: add });
