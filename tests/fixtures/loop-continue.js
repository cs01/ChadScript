function sumSkipThree(n) {
  let sum = 0;
  for (let i = 1; i <= n; i = i + 1) {
    if (i === 3) {
      continue;
    }
    sum = sum + i;
  }
  return sum;
}

sumSkipThree(5);
