// @test-exit-code: 43
function findFirst(threshold: number) {
  let result = 0;
  for (let i = 1; i <= 100; i = i + 1) {
    if (i > threshold) {
      result = i;
      break;
    }
  }
  return result;
}

process.exit(findFirst(42));
