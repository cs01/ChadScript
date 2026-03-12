const str = "hello world";

if (!str.endsWith("hello", 5)) {
  console.log("FAIL: endsWith hello at position 5");
  process.exit(1);
}

if (str.endsWith("world", 5)) {
  console.log("FAIL: endsWith world at position 5 should be false");
  process.exit(1);
}

if (!str.endsWith("world", 11)) {
  console.log("FAIL: endsWith world at position 11 (full length)");
  process.exit(1);
}

if (str.endsWith("hello", 3)) {
  console.log("FAIL: endsWith hello at position 3 should be false (suffix longer than substring)");
  process.exit(1);
}

if (!str.endsWith("lo", 5)) {
  console.log("FAIL: endsWith lo at position 5");
  process.exit(1);
}

if (!str.endsWith("world", 100)) {
  console.log("FAIL: endsWith with position past end should clamp to string length");
  process.exit(1);
}

if (str.endsWith("hello", -1)) {
  console.log("FAIL: endsWith with negative position should be false");
  process.exit(1);
}

console.log("TEST_PASSED");
