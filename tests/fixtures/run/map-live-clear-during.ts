// clear() during iteration ends the walk over the old entries, but entries added after the clear
// are still visited by the same iterator.
const m = new Map<number, number>();
for (let i = 0; i < 5; i++) m.set(i, i * i);
for (const k of m.keys()) {
  console.log("k", k);
  if (k === 1) m.clear();
}
console.log(m.size);
for (let i = 0; i < 5; i++) m.set(i, i);
let added = false;
for (const v of m.values()) {
  console.log("v", v);
  if (v === 2 && !added) {
    added = true;
    m.clear();
    m.set(100, 7);
    m.set(200, 8);
  }
}
console.log([...m.keys()]);
const s = new Set<string>(["p", "q", "r"]);
for (const v of s) {
  console.log("s", v);
  s.clear();
}
console.log(s.size);
