// Entries added during iteration are visited, in insertion order, including ones added while
// visiting the last entry (enough adds to force the table to grow mid-loop).
const m = new Map<number, string>();
m.set(1, "one");
for (const k of m.keys()) {
  if (k < 40) m.set(k * 2, "n" + k);
  if (k % 3 === 0) m.delete(k - 1);
}
console.log([...m.keys()].join(","), m.size);
const s = new Set<string>(["x"]);
for (const v of s) {
  if (v.length < 6) {
    s.add(v + "y");
    s.add(v + "z");
  }
}
console.log(s.size, [...s].slice(0, 8).join(" "));
