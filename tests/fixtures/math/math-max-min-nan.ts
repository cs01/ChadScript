let passed = true;

if (Math.max(1, 5) !== 5) passed = false;
if (Math.min(1, 5) !== 1) passed = false;
if (!isNaN(Math.max(1, NaN))) passed = false;
if (!isNaN(Math.min(1, NaN))) passed = false;
if (!isNaN(Math.max(NaN, NaN))) passed = false;
if (!isNaN(Math.min(NaN, NaN))) passed = false;
if (Math.max(-3, -1) !== -1) passed = false;
if (Math.min(-3, -1) !== -3) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
