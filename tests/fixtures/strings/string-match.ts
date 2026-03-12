const str = "hello world 123";
const result = str.match(/([0-9]+)/);
if (result === null) {
  console.log("FAIL: match returned null");
  process.exit(1);
}
if (result[0] !== "123") {
  console.log("FAIL: match[0] expected 123, got " + result[0]);
  process.exit(1);
}
if (result[1] !== "123") {
  console.log("FAIL: match[1] expected 123, got " + result[1]);
  process.exit(1);
}

const noMatch = "hello".match(/([0-9]+)/);
if (noMatch !== null) {
  console.log("FAIL: expected null for no match");
  process.exit(1);
}

console.log("TEST_PASSED");
