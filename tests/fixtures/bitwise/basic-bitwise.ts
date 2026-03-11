let passed = true;

if ((5 & 3) !== 1) passed = false;
if ((5 | 3) !== 7) passed = false;
if ((5 ^ 3) !== 6) passed = false;
if (~0 !== -1) passed = false;

if (1 << 3 !== 8) passed = false;
if (16 >> 2 !== 4) passed = false;
if (255 >>> 4 !== 15) passed = false;

const a = 0xff;
const b = 0x0f;
if ((a & b) !== 15) passed = false;
if ((a | b) !== 255) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
