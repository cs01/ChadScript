type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

function area(s: Shape): number {
  if (s.kind === "circle") {
    return 3.14159 * s.radius * s.radius;
  }
  return s.side * s.side;
}

const c: Shape = { kind: "circle", radius: 5 };
const sq: Shape = { kind: "square", side: 4 };

console.log(area(c));
console.log(area(sq));
console.log(c.kind);
console.log(sq.kind);
