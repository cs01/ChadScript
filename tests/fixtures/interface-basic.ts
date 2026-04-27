interface Shape {
  area(): number;
  name: string;
}

class Circle implements Shape {
  name: string;
  radius: number;

  constructor(name: string, radius: number) {
    this.name = name;
    this.radius = radius;
  }

  area(): number {
    return 3.14159 * this.radius * this.radius;
  }
}

class Rectangle implements Shape {
  name: string;
  width: number;
  height: number;

  constructor(name: string, width: number, height: number) {
    this.name = name;
    this.width = width;
    this.height = height;
  }

  area(): number {
    return this.width * this.height;
  }
}

function printArea(shape: Shape): void {
  console.log(shape.name);
  console.log(shape.area());
}

const c = new Circle("circle", 5);
const r = new Rectangle("rect", 3, 4);

printArea(c);
printArea(r);
console.log("TEST_PASSED");
