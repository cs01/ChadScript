let passed = true;

if (isNaN("abc") !== true) passed = false;
if (isNaN("hello world") !== true) passed = false;
if (isNaN("42") !== false) passed = false;
if (isNaN("-3.14") !== false) passed = false;
if (isNaN("0") !== false) passed = false;
if (isNaN(NaN) !== true) passed = false;
if (isNaN(42) !== false) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
