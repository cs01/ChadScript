// @known-bug: phase 3 (shaped objects): two interfaces with reordered fields alias one object
interface P {
  x: number;
  y: number;
}
interface Q {
  y: number;
  x: number;
}
const p: P = { x: 1, y: 2 };
const q: Q = p;
q.x = 10;
console.log(p.x, q.y);
