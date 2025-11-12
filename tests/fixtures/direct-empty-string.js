function test() {
  const empty = "";
  if (empty.length === 0) {
    return 42;
  }
  return 1;
}

process.exit(test());
