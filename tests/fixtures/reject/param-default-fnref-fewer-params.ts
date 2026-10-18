// @expect-reject: CS1217
function fnRef(a: number, b = 7): number {
  return a - b;
}
const h: (a: number) => number = fnRef;
console.log(h(1));
