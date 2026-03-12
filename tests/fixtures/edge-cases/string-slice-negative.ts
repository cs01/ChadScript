let passed = true;

const s = "hello world";

if (s.slice(-5) !== "world") passed = false;
if (s.slice(0, -6) !== "hello") passed = false;
if (s.slice(-5, -1) !== "worl") passed = false;
if (s.slice(6) !== "world") passed = false;
if (s.slice(0, 5) !== "hello") passed = false;

if (passed) {
  console.log("TEST_PASSED");
}
