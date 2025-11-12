function double(x) {
  return x + x;
}

function testForEach() {
  const arr = [1, 2, 3, 4];
  arr.forEach(double);
  return 10;
}

process.exit(testForEach());
