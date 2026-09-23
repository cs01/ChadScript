// @expect-reject: CS1228
// A class binding is not hoisted: `make` runs before the class declaration, so Node throws
// ReferenceError where compiled code would construct it anyway.
function make(): Point {
  return new Point(1);
}
const p = make();
class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
console.log(p.x);
