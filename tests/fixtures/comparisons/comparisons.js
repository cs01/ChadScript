function test(a, b) {
  let isLess = a < b;
  let isGreater = a > b;
  let isEqual = a == b;
  return isLess + isGreater + isEqual;
}

process.exit(test(5, 10));
