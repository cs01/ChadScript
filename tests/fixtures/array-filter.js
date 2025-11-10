function isGreaterThan2(x) {
  let result = 0;
  if (x > 2) {
    result = 1;
  }
  return result;
}

function testFilter() {
  const arr = [1, 2, 3, 4, 5];
  const filtered = arr.filter(isGreaterThan2);
  return filtered.length;
}

testFilter();
