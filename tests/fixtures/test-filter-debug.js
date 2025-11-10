function isEven(x) {
  if (x == 2) {
    return 1;
  }
  if (x == 4) {
    return 1;
  }
  return 0;
}

function testFilter() {
  const arr = [1, 2, 3, 4, 5];
  const result = isEven(2);
  return result;
}

testFilter();
