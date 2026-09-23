// @expect-reject: CS1222
const m = new Map<string, number>();
m.set("a", 1);
for (const k of m.keys()) {
  if (m.size < 4) m.set(k + "x", 1);
}
console.log([...m.keys()]);
const s = new Set<number>([1]);
for (const v of s.values()) {
  if (v < 4) s.add(v + 1);
}
console.log(s);
