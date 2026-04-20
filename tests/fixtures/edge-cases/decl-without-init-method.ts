// @test-description: let x: T; without init lets later method resolution work

interface Shape {
  area(): number;
  name(): string;
}

class Circle {
  area(): number {
    return 3.14;
  }
  name(): string {
    return "circle";
  }
}

function getShape(useCircle: boolean): Shape {
  let s: Shape;
  if (useCircle) {
    s = new Circle() as Shape;
  } else {
    s = new Circle() as Shape;
  }
  return s;
}

function main(): number {
  const shape = getShape(true);
  const a = shape.area();
  const n = shape.name();
  if (a === 3.14 && n === "circle") {
    console.log("TEST_PASSED");
    return 0;
  }
  console.log("FAIL a=" + a + " n=" + n);
  return 1;
}

main();
