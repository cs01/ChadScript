// forEach on a Map passes (value, key) and on a Set (value, value); both are live like for...of.
const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);
m.forEach((v, k) => {
  console.log(k, v);
  if (k === "a") m.delete("c");
  if (k === "b") m.set("z", 26);
});
m.forEach((v) => console.log("v", v));
const s = new Set<number>([3, 1, 2]);
let total = 0;
s.forEach((v) => {
  total += v;
  if (v === 1) s.add(9);
});
console.log(total);
s.forEach((v, w) => console.log(v === w, v));
