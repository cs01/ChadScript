// @expect-reject: CS1236
// `p` is typed with number fields only, but an object with a string field can reach it, so
// Object.values could return a mix that one array cannot hold.
interface P {
  x: number;
}
const q = { x: 1, label: "q" };
const r = { x: 2 };
function vals(p: P): number[] {
  return Object.values(p);
}
console.log(vals(q), vals(r));
