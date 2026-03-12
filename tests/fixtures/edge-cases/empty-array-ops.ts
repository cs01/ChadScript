let passed = true;

const arr: number[] = [];
if (arr.length !== 0) passed = false;

const sliced = arr.slice(0);
if (sliced.length !== 0) passed = false;

arr.push(42);
if (arr.length !== 1) passed = false;
if (arr[0] !== 42) passed = false;

const popped = arr.pop();
if (popped !== 42) passed = false;
if (arr.length !== 0) passed = false;

const idx = arr.indexOf(99);
if (idx !== -1) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
