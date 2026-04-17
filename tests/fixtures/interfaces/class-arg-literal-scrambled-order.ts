interface Point {
  x: number;
  y: number;
}

class Vec {
  dx: number;
  dy: number;
  constructor(p: Point) {
    this.dx = p.x;
    this.dy = p.y;
  }
  dot(other: Point): number {
    return this.dx * other.x + this.dy * other.y;
  }
}

function main(): void {
  const v = new Vec({ y: 3, x: 4 });
  const r = v.dot({ y: 10, x: 5 });
  if (v.dx === 4 && v.dy === 3 && r === 4 * 5 + 3 * 10) {
    console.log("TEST_PASSED");
  }
}

main();
