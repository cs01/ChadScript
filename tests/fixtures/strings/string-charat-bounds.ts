const s = "hello";
let passed = true;

if (s.charAt(0) !== "h") passed = false;
if (s.charAt(4) !== "o") passed = false;
if (s.charAt(5) !== "") passed = false;
if (s.charAt(-1) !== "") passed = false;

if (s.charCodeAt(0) !== 104) passed = false;
if (s.charCodeAt(4) !== 111) passed = false;
if (s.charCodeAt(5) !== 0) passed = false;
if (s.charCodeAt(-1) !== 0) passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
