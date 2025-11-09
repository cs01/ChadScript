function abs(x) {
  let result = x;
  if (x < 0) {
    result = 0 - x;
  }
  return result;
}

abs(0 - 42);
