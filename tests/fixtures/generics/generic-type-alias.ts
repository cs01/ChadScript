type Point = {
  x: number;
  y: number;
};
class Box<T> {
  value: T;
  constructor(v: T) {
    this.value = v;
  }
  get(): T {
    return this.value;
  }
}
const b = new Box<Point>({ x: 3, y: 4 });
const p: Point = b.get();
console.log(p.x.toString());
console.log(p.y.toString());
console.log("TEST_PASSED");
