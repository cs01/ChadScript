class Vec2 {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function magnitude(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function add(a: Vec2, b: Vec2): Vec2 {
  return new Vec2(a.x + b.x, a.y + b.y);
}

function main(): void {
  const a = new Vec2(3, 4);
  const b = new Vec2(1, 2);
  const c = add(a, b);

  if (magnitude(a) === 5 && c.x === 4 && c.y === 6) {
    console.log("TEST_PASSED");
  }
}

main();
