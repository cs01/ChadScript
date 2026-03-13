class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  distanceTo(other: Point): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  add(other: Point): Point {
    return new Point(this.x + other.x, this.y + other.y);
  }
}

class Line {
  start: Point;
  end: Point;

  constructor(start: Point, end: Point) {
    this.start = start;
    this.end = end;
  }

  length(): number {
    return this.start.distanceTo(this.end);
  }
}

const p1 = new Point(0, 0);
const p2 = new Point(3, 4);
const line = new Line(p1, p2);

const len = line.length();
if (len !== 5) {
  process.exit(1);
}

const p3 = new Point(1, 1);
const p4 = p1.add(p3);
if (p4.x !== 1) {
  process.exit(1);
}
if (p4.y !== 1) {
  process.exit(1);
}

const d = p1.distanceTo(p3);
if (d < 1.41 || d > 1.42) {
  process.exit(1);
}

console.log("TEST_PASSED");
