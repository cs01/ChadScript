let passed = true;

let x = 5;
x = x + 1;
if (x !== 6) passed = false;
x = x - 1;
if (x !== 5) passed = false;

const neg = -10;
if (neg !== -10) passed = false;

let y = 0;
y = y + 1;
y = y + 1;
y = y + 1;
if (y !== 3) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
