const valid = Number("42");
const negative = Number("-3.14");
const zero = Number("0");
const invalid = Number("abc");
const empty = Number("");

let passed = true;

if (valid !== 42) passed = false;
if (negative !== -3.14) passed = false;
if (zero !== 0) passed = false;
if (!isNaN(invalid)) passed = false;
if (!isNaN(empty)) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
