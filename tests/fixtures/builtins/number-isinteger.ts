let passed = true;

if (Number.isInteger(42) !== true) passed = false;
if (Number.isInteger(0) !== true) passed = false;
if (Number.isInteger(-5) !== true) passed = false;
if (Number.isInteger(3.14) !== false) passed = false;
if (Number.isInteger(NaN) !== false) passed = false;
if (Number.isInteger(Infinity) !== false) passed = false;
if (Number.isInteger(-Infinity) !== false) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
