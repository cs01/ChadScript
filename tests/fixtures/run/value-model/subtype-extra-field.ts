// @known-bug: phase 3 (shaped objects): layout comes from the static type, so p.x reads slot 0 (y)
interface P {
  x: number;
}
function f(p: P): number {
  return p.x;
}
const q = { y: 2, x: 5 };
console.log(f(q));
