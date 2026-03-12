let passed = true;

const arr = [1, 2, 3, 4, 5];

const s1 = arr.slice(-2);
if (s1.length !== 2) passed = false;
if (s1[0] !== 4) passed = false;
if (s1[1] !== 5) passed = false;

const s2 = arr.slice(0, -2);
if (s2.length !== 3) passed = false;
if (s2[0] !== 1) passed = false;
if (s2[2] !== 3) passed = false;

const s3 = arr.slice(1, 3);
if (s3.length !== 2) passed = false;
if (s3[0] !== 2) passed = false;
if (s3[1] !== 3) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
