class Vec {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  add(other: Vec): Vec {
    return new Vec(this.x + other.x, this.y + other.y);
  }
}

const a = new Vec(1, 2);
const b = new Vec(3, 4);
const c = a.add(b);

if (c.x !== 4) {
  process.exit(1);
}
if (c.y !== 6) {
  process.exit(1);
}

console.log("TEST_PASSED");
