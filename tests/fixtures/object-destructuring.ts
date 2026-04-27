class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const p = new Point(10, 20);
const { x, y } = p;
console.log(x);
console.log(y);

const { x: px, y: py } = new Point(30, 40);
console.log(px);
console.log(py);

function getCoords(pt: Point): number {
  const { x: a, y: b } = pt;
  return a + b;
}
console.log(getCoords(new Point(100, 200)));
