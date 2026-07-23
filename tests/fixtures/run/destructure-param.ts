// Object-destructured parameters in free functions, methods, constructors, and async functions.
interface Point {
  x: number;
  y: number;
}
function mag({ x, y }: Point): number {
  return x * x + y * y;
}
function label({ x: a, y: b }: Point, tag: string): string {
  return tag + ":" + a + "," + b;
}
class Box {
  area: number;
  constructor({ x, y }: Point) {
    this.area = x * y;
  }
  scaledBy({ x, y }: Point): number {
    return this.area + x + y;
  }
}
async function report({ x, y }: Point): Promise<void> {
  console.log("sum", x + y);
}
console.log(mag({ x: 3, y: 4 }));
console.log(label({ x: 1, y: 2 }, "p"));
const b = new Box({ x: 5, y: 6 });
console.log(b.area, b.scaledBy({ x: 1, y: 1 }));
report({ x: 10, y: 20 });
