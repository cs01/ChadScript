// @category: oop
// An abstract base class with polymorphic subclasses, an interface for things that can be
// scaled, static factory methods, getters, and toString overrides.

interface Scalable {
  scale(factor: number): void;
}

abstract class Shape {
  private static created = 0;
  readonly id: number;

  constructor(public readonly name: string) {
    Shape.created++;
    this.id = Shape.created;
  }

  abstract area(): number;
  abstract perimeter(): number;

  describe(): string {
    return `#${this.id} ${this.name}: area=${this.area().toFixed(2)} perimeter=${this.perimeter().toFixed(2)}`;
  }

  static count(): number {
    return Shape.created;
  }
}

class Circle extends Shape implements Scalable {
  constructor(private radius: number) {
    super("circle");
  }
  area(): number {
    return Math.PI * this.radius ** 2;
  }
  perimeter(): number {
    return 2 * Math.PI * this.radius;
  }
  scale(factor: number): void {
    this.radius *= factor;
  }
}

class Rectangle extends Shape implements Scalable {
  constructor(
    protected width: number,
    protected height: number,
    name = "rectangle",
  ) {
    super(name);
  }
  area(): number {
    return this.width * this.height;
  }
  perimeter(): number {
    return 2 * (this.width + this.height);
  }
  scale(factor: number): void {
    this.width *= factor;
    this.height *= factor;
  }
  get isSquare(): boolean {
    return this.width === this.height;
  }
}

class Square extends Rectangle {
  constructor(side: number) {
    super(side, side, "square");
  }
  override describe(): string {
    return `${super.describe()} (side ${this.width})`;
  }
}

class Triangle extends Shape {
  constructor(
    private a: number,
    private b: number,
    private c: number,
  ) {
    super("triangle");
    if (a + b <= c || a + c <= b || b + c <= a) throw new Error(`invalid triangle ${a},${b},${c}`);
  }
  area(): number {
    const s = this.perimeter() / 2;
    return Math.sqrt(s * (s - this.a) * (s - this.b) * (s - this.c));
  }
  perimeter(): number {
    return this.a + this.b + this.c;
  }
}

function isScalable(s: Shape): s is Shape & Scalable {
  return "scale" in s;
}

const shapes: Shape[] = [new Circle(1), new Rectangle(3, 4), new Square(2), new Triangle(3, 4, 5)];
for (const s of shapes) console.log(s.describe());

for (const s of shapes) if (isScalable(s)) s.scale(2);
console.log("after scaling x2:");
for (const s of shapes) console.log(s.describe());

const total = shapes.reduce((sum, s) => sum + s.area(), 0);
console.log(`total area ${total.toFixed(3)}, shapes created: ${Shape.count()}`);
const largest = shapes.reduce((a, b) => (b.area() > a.area() ? b : a));
console.log(`largest: ${largest.name}`, largest instanceof Rectangle, largest instanceof Shape);
console.log(shapes.filter((s): s is Rectangle => s instanceof Rectangle).map((r) => r.isSquare));

try {
  new Triangle(1, 2, 10);
} catch (e) {
  console.log(`error: ${(e as Error).message}`);
}
