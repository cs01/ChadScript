function test() {
  const empty = "";
  const len = empty.length;
  
  if (len === 0) {
    return 42;
  }
  return 1;
}

process.exit(test());
