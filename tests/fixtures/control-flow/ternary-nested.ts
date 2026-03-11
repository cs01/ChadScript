let passed = true;

const x = 5;
const result1 = x > 3 ? "big" : "small";
if (result1 !== "big") passed = false;

const result3 = false ? "yes" : "no";
if (result3 !== "no") passed = false;

const a = 1;
const b = 2;
const max = a > b ? a : b;
if (max !== 2) passed = false;

const numResult = x > 10 ? 100 : x > 3 ? 50 : 0;
if (numResult !== 50) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
