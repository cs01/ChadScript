// @test-exit-code: 55
function sumRange(n) {
  let sum = 0;
  for (let i = 1; i <= n; i = i + 1) {
    sum = sum + i;
  }
  return sum;
}

process.exit(sumRange(10));
