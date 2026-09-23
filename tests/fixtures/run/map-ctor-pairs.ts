// `new Map([[k, v], ...])`: insertion order, a later duplicate key wins, union values, number keys,
// and an empty entries list.
const ages = new Map<string, number>([
  ["ann", 31],
  ["bob", 42],
  ["ann", 32],
]);
console.log(ages.size, ages.get("ann"), [...ages.keys()], ages);
const names = new Map<number, string>([
  [2, "two"],
  [1, "one"],
]);
for (const k of names.keys()) console.log(k, names.get(k));
const mixed = new Map<string, number | string>([
  ["n", 1],
  ["s", "x"],
]);
console.log(mixed);
const none = new Map<string, boolean>([]);
console.log(none.size);
let calls = 0;
function next(): number {
  calls++;
  return calls;
}
const ordered = new Map<string, number>([
  ["first", next()],
  ["second", next()],
]);
console.log(ordered);
