// Set.prototype.add and Map.prototype.set store -0 as +0 (the key is normalized, not just matched).
const s = new Set<number>();
s.add(-0);
s.add(0);
console.log(s, s.size, s.has(0));
for (const v of [...s]) console.log(1 / v);
const m = new Map<number, string>();
m.set(-0, "z");
console.log(m, [...m.keys()]);
