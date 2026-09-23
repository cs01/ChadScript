// @expect-reject: CS1244
class Point {
  x = 1;
}
function make<T>(c: new () => T): T {
  return new c();
}
console.log(make(Point));
