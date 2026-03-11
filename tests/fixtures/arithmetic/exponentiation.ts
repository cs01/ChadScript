let passed = true;

if (2 ** 3 !== 8) passed = false;
if (3 ** 2 !== 9) passed = false;
if (2 ** 0 !== 1) passed = false;
if (2 ** 10 !== 1024) passed = false;

const base = 5;
const exp = 3;
if (base ** exp !== 125) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
