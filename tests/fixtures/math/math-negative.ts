let passed = true;

if (Math.floor(-3.7) !== -4) passed = false;
if (Math.floor(-0.1) !== -1) passed = false;
if (Math.ceil(-3.7) !== -3) passed = false;
if (Math.ceil(-0.1) !== 0) passed = false;
if (Math.round(-0.4) !== 0) passed = false;
if (Math.round(-0.6) !== -1) passed = false;
if (Math.abs(-5) !== 5) passed = false;
if (Math.abs(5) !== 5) passed = false;
if (Math.abs(-3.7) !== 3.7) passed = false;
if (Math.min(-5, -3) !== -5) passed = false;
if (Math.max(-5, -3) !== -3) passed = false;
if (Math.sqrt(4) !== 2) passed = false;
if (Math.pow(2, 10) !== 1024) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
