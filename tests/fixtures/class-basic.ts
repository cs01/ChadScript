class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  distanceTo(other: Point): number {
    const dx: number = this.x - other.x;
    const dy: number = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

let p1: Point = new Point(0, 0);
let p2: Point = new Point(3, 4);
console.log(p1.x);
console.log(p2.y);
console.log(p1.distanceTo(p2));
