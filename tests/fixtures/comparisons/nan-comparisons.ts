let passed = true;

const nan = NaN;

if (nan === nan) {
  console.log("FAIL: nan === nan should be false");
  passed = false;
}
if (!(nan !== nan)) {
  console.log("FAIL: nan !== nan should be true");
  passed = false;
}
if (nan === 1) {
  console.log("FAIL: nan === 1 should be false");
  passed = false;
}
if (!(nan !== 1)) {
  console.log("FAIL: nan !== 1 should be true");
  passed = false;
}
if (nan < 1) {
  console.log("FAIL: nan < 1 should be false");
  passed = false;
}
if (nan > 1) {
  console.log("FAIL: nan > 1 should be false");
  passed = false;
}

if (1 !== 2) {
} else {
  console.log("FAIL: 1 !== 2 should be true");
  passed = false;
}

if (1 === 1) {
} else {
  console.log("FAIL: 1 === 1 should be true");
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
