class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Shape {
  points: Point[];
  constructor() {
    this.points = [];
  }
  addPoint(x: number, y: number): void {
    this.points.push(new Point(x, y));
  }
  totalX(): number {
    let sum = 0;
    for (const p of this.points) {
      sum = sum + p.x;
    }
    return sum;
  }
}

const s = new Shape();
s.addPoint(10, 20);
s.addPoint(30, 40);
s.addPoint(50, 60);

if (s.totalX() === 90) {
  console.log("TEST_PASSED");
}
