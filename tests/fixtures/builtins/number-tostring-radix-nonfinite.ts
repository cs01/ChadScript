// @test-description: Number.toString(radix) honors the base; non-finite numbers use JS spelling
let passed = true;

if ((255).toString(16) !== "ff") passed = false;
if ((10).toString(2) !== "1010") passed = false;
if ((64).toString(8) !== "100") passed = false;
if ((-255).toString(16) !== "-ff") passed = false;
if ((0).toString(16) !== "0") passed = false;
if ((255).toString(10) !== "255") passed = false;
if ((42).toString() !== "42") passed = false;

// Non-finite values must stringify as JS does, not C's inf/nan.
if ("" + 1 / 0 !== "Infinity") passed = false;
if ("" + -1 / 0 !== "-Infinity") passed = false;
if ("" + 0 / 0 !== "NaN") passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL");
}
