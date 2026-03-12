let passed = true;

const s = "hello world hello";

if (s.lastIndexOf("hello") !== 12) passed = false;
if (s.lastIndexOf("hello", 11) !== 0) passed = false;
if (s.lastIndexOf("hello", 0) !== 0) passed = false;
if (s.lastIndexOf("hello", 12) !== 12) passed = false;
if (s.lastIndexOf("xyz") !== -1) passed = false;
if (s.lastIndexOf("hello", -1) !== -1) passed = false;
if (s.lastIndexOf("o", 4) !== 4) passed = false;
if (s.lastIndexOf("o", 3) !== -1) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
