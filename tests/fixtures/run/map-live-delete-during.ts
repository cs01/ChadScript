// Deleting during keys()/values() iteration: a deleted entry not yet reached is never visited,
// and deleting the current entry does not skip its successor (Node's iterators are live).
const m = new Map<string, number>();
for (const k of ["a", "b", "c", "d", "e"]) m.set(k, k.length * 10);
for (const k of m.keys()) {
  console.log("visit", k);
  if (k === "a") m.delete("c");
  if (k === "b") m.delete("b");
}
console.log([...m.keys()], m.size);
const s = new Set<number>([1, 2, 3, 4, 5, 6]);
for (const v of s.values()) {
  console.log("set visit", v);
  if (v % 2 === 1) s.delete(v + 1);
}
console.log(s, s.size);
for (const v of m.values()) {
  console.log("value", v);
  m.delete("e");
}
