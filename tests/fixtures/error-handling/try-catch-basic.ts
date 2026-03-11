// @test-skip
let passed = true;

try {
  const x = 1;
  if (x !== 1) passed = false;
} catch (e) {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
