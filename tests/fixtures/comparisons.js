function test(a, b) {
  let isLess = a < b;
  let isGreater = a > b;
  let isEqual = a == b;
  return isLess + isGreater + isEqual;
}

test(5, 10);
