// Tests that integer globals use i64 optimization instead of double
const LIMIT = 100;
const STEP = 10;
let counter = 0;

// Arithmetic between integer globals
const total = LIMIT + STEP;
counter = LIMIT - STEP;

// Integer comparison
if (counter === 90) {
  console.log("comparison works");
} else {
  console.log("FAIL: comparison");
  process.exit(1);
}

// Verify arithmetic result
if (total === 110) {
  console.log("arithmetic works");
} else {
  console.log("FAIL: arithmetic");
  process.exit(1);
}

console.log("TEST_PASSED");
