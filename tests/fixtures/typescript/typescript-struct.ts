interface Point {
  x: number;
  y: number;
}

function distance(p: Point): number {
  return p.x + p.y;
}

const point = { x: 3, y: 4 };
process.exit(distance(point));
