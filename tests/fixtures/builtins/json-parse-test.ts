// JSON.parse() integration test
interface User {
  name: string;
  age: number;
}

// Test 1: Parse simple object
const user = JSON.parse('{"name":"Alice","age":30}');
if (user.name !== "Alice") {
  console.log("FAILED: Expected name to be Alice");
  process.exit(1);
}
if (user.age !== 30) {
  console.log("FAILED: Expected age to be 30");
  process.exit(1);
}

// Test 2: Parse array
const arr = JSON.parse("[1,2,3]");
if (arr[0] !== 1 || arr[1] !== 2 || arr[2] !== 3) {
  console.log("FAILED: Array parsing incorrect");
  process.exit(1);
}

// Test 3: Parse nested object
const nested = JSON.parse('{"user":{"name":"Bob","score":100}}');
if (nested.user.name !== "Bob") {
  console.log("FAILED: Nested object parsing failed");
  process.exit(1);
}

console.log("TEST_PASSED");
