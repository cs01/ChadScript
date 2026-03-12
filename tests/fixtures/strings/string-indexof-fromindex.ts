let passed = true;

const s = "hello world hello";

if (s.indexOf("hello") !== 0) passed = false;
if (s.indexOf("hello", 1) !== 12) passed = false;
if (s.indexOf("hello", 12) !== 12) passed = false;
if (s.indexOf("hello", 13) !== -1) passed = false;
if (s.indexOf("world", 0) !== 6) passed = false;
if (s.indexOf("xyz", 0) !== -1) passed = false;
if (s.indexOf("hello", -5) !== 0) passed = false;
if (s.indexOf("hello", 100) !== -1) passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
