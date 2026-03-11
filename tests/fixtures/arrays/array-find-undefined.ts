let passed = true;

const nums: number[] = [1, 2, 3, 4, 5];

const found = nums.find((x: number): boolean => x === 3);
if (found !== 3) passed = false;

const empty: number[] = [];
const notFound = empty.find((x: number): boolean => x === 99);
if (notFound !== undefined) passed = false;

const idx = nums.findIndex((x: number): boolean => x === 4);
if (idx !== 3) passed = false;

const noIdx = nums.findIndex((x: number): boolean => x === 99);
if (noIdx !== -1) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
