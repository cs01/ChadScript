let passed = true;

if (Math.sign(5) !== 1) passed = false;
if (Math.sign(-5) !== -1) passed = false;
if (Math.sign(0) !== 0) passed = false;
if (!isNaN(Math.sign(NaN))) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
