function test() {
  const str = "Hello World";

  // substring(start) - from start to end
  const a = str.substring(6);
  console.log(a); // "World"

  // substring(start, end) - from start to end (not including end)
  const b = str.substring(0, 5);
  console.log(b); // "Hello"

  // Test with split (in separate steps to avoid chaining issues)
function test() {
  const str = "Hello";
  // substring(start, end) - extracts from index 1 to (but not including) index 4
  // "Hello".substring(1, 4) = "ell" (length 3)
  const result = str.substring(1, 4);
  return result.length;
}

process.exit(test());
