// JSON.parse() integration test
interface User {
  name: string;
  age: number;
}

interface UserScore {
  name: string;
  score: number;
}

interface NestedUser {
  user: UserScore;
}

// Test 1: Parse simple object
const user = JSON.parse<User>('{"name":"Alice","age":30}');
if (user.name !== "Alice") {
  throw new Error("Expected name to be Alice");
}
if (user.age !== 30) {
  throw new Error("Expected age to be 30");
}

// Test 2: Parse array
const arr = JSON.parse<number[]>("[1,2,3]");
if (arr[0] !== 1 || arr[1] !== 2 || arr[2] !== 3) {
  throw new Error("Array parsing incorrect");
}

// Test 3: Parse nested object
const nested = JSON.parse<NestedUser>('{"user":{"name":"Bob","score":100}}');
if (nested.user.name !== "Bob") {
  throw new Error("Nested object parsing failed");
}

console.log("TEST_PASSED");
