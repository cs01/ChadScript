let passed = true;

const s = "ABCDE";

if (s.substring(1, 3) !== "BC") passed = false;
if (s.substring(3, 1) !== "BC") passed = false;
if (s.substring(0, 5) !== "ABCDE") passed = false;
if (s.substring(2) !== "CDE") passed = false;
if (s.substring(0, 0) !== "") passed = false;
if (s.substring(2, 2) !== "") passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
