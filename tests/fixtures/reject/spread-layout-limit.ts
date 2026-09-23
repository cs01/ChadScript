// @expect-reject: CS1236
// Nine layouts can reach each source, so this spread has 81 source-layout combinations to dispatch.
interface X {
  x: number;
}
const l0 = { x: 0 };
const l1 = { x: 1, a: 1 };
const l2 = { x: 2, b: 1 };
const l3 = { x: 3, c: 1 };
const l4 = { x: 4, d: 1 };
const l5 = { x: 5, e: 1 };
const l6 = { x: 6, f: 1 };
const l7 = { x: 7, g: 1 };
const l8 = { x: 8, h: 1 };
function merge(p: X, q: X): X {
  return { ...p, ...q };
}
const all: X[] = [l0, l1, l2, l3, l4, l5, l6, l7, l8];
console.log(merge(all[0] ?? l0, all[1] ?? l1));
