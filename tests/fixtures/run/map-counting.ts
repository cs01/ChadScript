const counts = new Map<number, number>();
const nums = [1, 2, 2, 3, 3, 3];
for (const n of nums) {
  counts.set(n, (counts.get(n) ?? 0) + 1);
}
console.log(counts.get(1) ?? 0);
console.log(counts.get(2) ?? 0);
console.log(counts.get(3) ?? 0);
console.log(counts.size);
