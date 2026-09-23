// An array literal whose own type has no representation (`never[]` inside, or a union of array
// types) is built in the element type of the slot it initializes.
const empty: number[][][][] = [[[[]]]];
console.log(empty, empty.length);
const mixed: (number | string)[][] = [
  ["a", "b"],
  [1, 2],
  [3, "c"],
];
console.log(mixed);
const first = mixed[0];
if (first !== undefined) first.push(9);
console.log(first, mixed.length);
function total(rows: (number | string)[][]): number {
  let n = 0;
  for (const r of rows) n += r.length;
  return n;
}
console.log(total([["x"], [1], []]));
