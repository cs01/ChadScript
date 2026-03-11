let passed = true;

if (2 + 3 * 4 !== 14) passed = false;
if ((2 + 3) * 4 !== 20) passed = false;
if (10 - 2 * 3 !== 4) passed = false;
if (10 / 2 + 3 !== 8) passed = false;
const x = 2 + 3 * 4 - 1;
if (x !== 13) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
