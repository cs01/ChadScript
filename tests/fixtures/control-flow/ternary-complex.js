function test() {
  const a = 10;
  const b = 20;
  const c = 30;

  // Complex ternary with multiple operations
  const result = (a < b ? c : a) + (b > a ? 10 : 5);
  // (10 < 20 ? 30 : 10) + (20 > 10 ? 10 : 5) = 30 + 10 = 40

  return result;
}

process.exit(test());
