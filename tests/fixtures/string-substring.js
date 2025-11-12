function test() {
  const str = "Hello";
  // substring(start, end) - extracts from index 1 to (but not including) index 4
  // "Hello".substring(1, 4) = "ell" (length 3)
  const result = str.substring(1, 4);
  return result.length;
}

process.exit(test());
