interface Acc {
  sum: number;
  count: number;
}
const a: Acc = { sum: 0, count: 0 };
for (let i = 1; i <= 5; i++) {
  a.sum += i;
  a.count++;
}
console.log(a.sum, a.count, a.sum / a.count);
