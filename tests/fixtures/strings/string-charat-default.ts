const str = "hello";

const first = str.charAt();
if (first !== "h") {
  console.log("FAIL: charAt() should return first char, got: " + first);
  process.exit(1);
}

const code = str.charCodeAt();
if (code !== 104) {
  console.log("FAIL: charCodeAt() should return 104 (h), got: " + code);
  process.exit(1);
}

const explicit = str.charAt(0);
if (explicit !== "h") {
  console.log("FAIL: charAt(0) should return h");
  process.exit(1);
}

const explicitCode = str.charCodeAt(0);
if (explicitCode !== 104) {
  console.log("FAIL: charCodeAt(0) should return 104");
  process.exit(1);
}

console.log("TEST_PASSED");
