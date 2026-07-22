interface Vec {
  x: number;
  y: number;
}
function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}
function make(x: number, y: number): Vec {
  return { x: x, y: y };
}
console.log(dot(make(1, 2), make(3, 4)));
