function test() {
  const str = "Hello World";

  // substring(start) - from start to end
  const a = str.substring(6);
  console.log(a); // "World"

  // substring(start, end) - from start to end (not including end)
  const b = str.substring(0, 5);
  console.log(b); // "Hello"

  // Test with split (in separate steps to avoid chaining issues)
  const temp = "one,two,three".substring(0, 7);
  const c = temp.split(',');
  console.log(c.length); // 2

  return 0;
}

test();
