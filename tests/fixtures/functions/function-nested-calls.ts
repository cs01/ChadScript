function double(n: number): number {
  return n * 2;
}

function addOne(n: number): number {
  return n + 1;
}

function compose(n: number): number {
  return addOne(double(n));
}

let passed = true;
if (compose(5) !== 11) passed = false;
if (compose(0) !== 1) passed = false;
if (double(addOne(3)) !== 8) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
