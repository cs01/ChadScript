function sumRange(n) {
  let sum = 0;
  for (let i = 1; i <= n; i = i + 1) {
    sum = sum + i;
  }
  return sum;
}

sumRange(10);
