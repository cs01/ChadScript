let passed = true;

if (0 !== 0) passed = false;
if (-0 !== 0) passed = false;

const arr: number[] = [];
if (arr.length !== 0) passed = false;

const neg = -42;
if (neg + 42 !== 0) passed = false;
if (neg * -1 !== 42) passed = false;

const large = 1000000;
if (large / 1000 !== 1000) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
