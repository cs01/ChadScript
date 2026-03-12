const pi = 3.14159;
const fixed2 = pi.toFixed(2);
if (fixed2 !== "3.14") {
  console.log("FAIL: toFixed(2) expected 3.14, got " + fixed2);
  process.exit(1);
}

const whole = 42.0;
const fixed0 = whole.toFixed(0);
if (fixed0 !== "42") {
  console.log("FAIL: toFixed(0) expected 42, got " + fixed0);
  process.exit(1);
}

console.log("TEST_PASSED");
