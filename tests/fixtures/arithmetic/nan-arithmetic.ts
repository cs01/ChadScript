let passed = true;

if (!isNaN(NaN + 1)) passed = false;
if (!isNaN(NaN - 1)) passed = false;
if (!isNaN(NaN * 2)) passed = false;
if (!isNaN(NaN / 2)) passed = false;
if (!isNaN(1 + NaN)) passed = false;
if (!isNaN(0 * NaN)) passed = false;

const x = 3 + 4;
if (x !== 7) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
