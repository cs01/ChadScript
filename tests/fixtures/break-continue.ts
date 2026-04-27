let sum: number = 0;
for (let i: number = 0; i < 100; i++) {
  if (i % 2 !== 0) continue;
  if (i > 20) break;
  sum = sum + i;
}
console.log(sum);
