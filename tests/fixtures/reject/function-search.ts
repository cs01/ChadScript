// @expect-reject: CS1245
function add(a: number): number {
  return a + 1;
}
const fns = [add];
console.log(fns.includes(add));
