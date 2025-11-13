function max(a, b) {
  let result = 0;
  if (a > b) {
    result = a;
  } else {
    result = b;
  }
  return result;
}

process.exit(max(15, 10));
