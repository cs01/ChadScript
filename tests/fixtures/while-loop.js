function countDown(n) {
  let i = n;
  let sum = 0;
  while (i > 0) {
    sum = sum + i;
    i = i - 1;
  }
  return sum;
}

countDown(5);
