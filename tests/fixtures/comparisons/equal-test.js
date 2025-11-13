function testEqual(a) {
  if (a === 0) {
    return 10;
  }
  return 1;
}

process.exit(testEqual(0));
