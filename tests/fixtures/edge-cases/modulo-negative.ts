let passed = true;

if (7 % 3 !== 1) passed = false;
if (-7 % 3 !== -1) passed = false;
if (7 % -3 !== 1) passed = false;
if (-7 % -3 !== -1) passed = false;
if (10 % 5 !== 0) passed = false;
if (1 % 1 !== 0) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
