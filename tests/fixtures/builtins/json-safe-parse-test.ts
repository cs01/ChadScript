interface SafeUser {
  name: string;
  age: number;
}

// Test 1: Missing string field gets empty string default
const missingName = JSON.parse<SafeUser>('{"age":25}');
if (missingName.name !== "") {
  throw new Error("Missing string field should default to empty string");
}
if (missingName.age !== 25) {
  throw new Error("Present number field should parse correctly");
}

// Test 2: Missing number field gets 0 default
const missingAge = JSON.parse<SafeUser>('{"name":"Bob"}');
if (missingAge.name !== "Bob") {
  throw new Error("Present string field should parse correctly");
}
if (missingAge.age !== 0) {
  throw new Error("Missing number field should default to 0");
}

// Test 3: All fields missing (empty object)
const empty = JSON.parse<SafeUser>("{}");
if (empty.name !== "") {
  throw new Error("Empty object string field should default to empty string");
}
if (empty.age !== 0) {
  throw new Error("Empty object number field should default to 0");
}

// Test 4: Wrong type - number where string expected
const wrongTypeStr = JSON.parse<SafeUser>('{"name":42,"age":10}');
if (wrongTypeStr.age !== 10) {
  throw new Error("Correct type field should still work");
}

// Test 5: Invalid JSON doesn't crash
const invalid = JSON.parse<SafeUser>("not valid json at all");
if (invalid.name !== "") {
  throw new Error("Invalid JSON string field should default to empty string");
}
if (invalid.age !== 0) {
  throw new Error("Invalid JSON number field should default to 0");
}

// Test 6: Valid JSON still works (regression check)
const valid = JSON.parse<SafeUser>('{"name":"Alice","age":30}');
if (valid.name !== "Alice") {
  throw new Error("Valid parse name should be Alice");
}
if (valid.age !== 30) {
  throw new Error("Valid parse age should be 30");
}

console.log("TEST_PASSED");
