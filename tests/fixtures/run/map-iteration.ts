const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);
for (const k of m.keys()) {
  console.log(k);
}
let sum = 0;
for (const v of m.values()) {
  sum += v;
}
console.log(sum);
