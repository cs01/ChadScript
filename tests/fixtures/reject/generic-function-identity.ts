// @expect-reject: CS1240
// Each callback crossing into generic code is wrapped, so identity would differ from Node.
function same<T>(f: (x: T) => T, g: (x: T) => T): boolean {
  return f === g;
}
const inc = (n: number): number => n + 1;
console.log(same(inc, inc));
