interface Shape {
  kind: string;
  area(): number;
}

class Circle {
  kind: string;
  radius: number;

  constructor(r: number) {
    this.kind = "circle";
    this.radius = r;
  }

  area(): number {
    return 3.14159 * this.radius * this.radius;
  }
}

function printArea(s: Shape): void {
  const a: number = s.area();
  if (a < 78 || a > 79) {
    console.log("FAIL: area should be ~78.5, got " + a);
    process.exit(1);
  }
}

function testInterfaceMethod(): void {
  const c = new Circle(5);
  printArea(c);
  console.log("TEST_PASSED");
}

testInterfaceMethod();
