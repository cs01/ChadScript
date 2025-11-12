function isGreaterThan2(x) {
  return x > 2;
}

function testFilter() {
  const arr = [1, 2, 3, 4, 5];
  const result = arr.filter(isGreaterThan2);
  // Should filter to [3, 4, 5], length = 3
  return result.length;
}

process.exit(testFilter());
