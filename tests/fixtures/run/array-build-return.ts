function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(i);
  }
  return out;
}
let sum = 0;
for (const x of range(5)) {
  sum += x;
}
console.log(sum);
