// Classes: inheritance, `super`, virtual method override (polymorphism), and `instanceof`.
class Shape {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  area(): number {
    return 0;
  }
  describe(): string {
    return this.name + " area ~= " + Math.round(this.area() * 100) / 100;
  }
}

class Circle extends Shape {
  radius: number;
  constructor(radius: number) {
    super("circle");
    this.radius = radius;
  }
  override area(): number {
    return Math.PI * this.radius * this.radius;
  }
}

class Rectangle extends Shape {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    super("rectangle");
    this.w = w;
    this.h = h;
  }
  override area(): number {
    return this.w * this.h;
  }
}

const shapes: Shape[] = [new Circle(2), new Rectangle(3, 4), new Shape("nothing")];

let total = 0;
for (const s of shapes) {
  // describe() lives on Shape but calls the runtime override of area() — virtual dispatch.
  console.log(s.describe());
  total += s.area();
  if (s instanceof Circle) {
    console.log("  (a circle of radius " + s.radius + ")");
  }
}
console.log("total area:", Math.round(total * 100) / 100);
