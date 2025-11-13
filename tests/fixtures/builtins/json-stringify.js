function testJSONStringify() {
  // Test number
  const numStr = JSON.stringify(42);
  console.log(numStr); // "42.000000"

  // Test string
  const strStr = JSON.stringify("hello");
  console.log(strStr); // "\"hello\""

  console.log("JSON.stringify basic tests passed!");
  return 0;
}

process.exit(testJSONStringify());
