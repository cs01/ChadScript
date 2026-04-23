// @test-exit-code: 15
function countDown(n: number) {
  let i = n;
  let sum = 0;
  while (i > 0) {
    sum = sum + i;
    i = i - 1;
  }
  return sum;
}

process.exit(countDown(5));
