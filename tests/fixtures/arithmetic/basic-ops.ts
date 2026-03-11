let passed = true;

if (2 + 3 !== 5) passed = false;
if (10 - 7 !== 3) passed = false;
if (4 * 6 !== 24) passed = false;
if (15 / 3 !== 5) passed = false;
if (17 % 5 !== 2) passed = false;

const a = 100;
const b = 37;
if (a + b !== 137) passed = false;
if (a - b !== 63) passed = false;
if (a * b !== 3700) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
