const s = new Set<number>([10, 20, 30, 20]);
for (const x of s.values()) {
  console.log(x);
}
let total = 0;
for (const x of s.values()) {
  total += x;
}
console.log(total);
