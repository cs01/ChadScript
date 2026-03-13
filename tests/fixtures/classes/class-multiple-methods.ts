class Circle {
  radius: number;
  constructor(radius: number) {
    this.radius = radius;
  }
  area(): number {
    return 3.14159 * this.radius * this.radius;
  }
}

class Rectangle {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  area(): number {
    return this.width * this.height;
  }
}

const c = new Circle(5);
const r = new Rectangle(4, 6);
const ca = c.area();
const ra = r.area();

if (ca < 78.5 || ca > 78.6) process.exit(1);
if (ra !== 24) process.exit(1);

const total = ca + ra;
if (total < 102.5 || total > 102.6) process.exit(1);

console.log("TEST_PASSED");
