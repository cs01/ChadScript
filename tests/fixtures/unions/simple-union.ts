interface Circle {
  type: string;
  radius: number;
}

interface Square {
  type: string;
  side: number;
}

type Shape = Circle | Square;

function makeCircle(r: number): Circle {
  const c: Circle = { type: "circle", radius: r };
  return c;
}

function makeSquare(s: number): Square {
  const sq: Square = { type: "square", side: s };
  return sq;
}

function getArea(shape: Shape): number {
  if (shape.type === "circle") {
    const c: Circle = shape;
    return 3.14159 * c.radius * c.radius;
  } else {
    const s: Square = shape;
    return s.side * s.side;
  }
}

const circle = makeCircle(10);
const square = makeSquare(5);

console.log(getArea(circle));
console.log(getArea(square));
