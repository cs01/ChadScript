interface P {
  x: number;
}
function f(p: P): number {
  return p.x;
}
const q = { y: 2, x: 5 };
console.log(f(q));
