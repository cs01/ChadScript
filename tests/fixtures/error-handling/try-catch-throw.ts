let passed = true;

let caught = false;
try {
  throw "test error";
  passed = false;
} catch (e) {
  caught = true;
  if (e !== "test error") passed = false;
}
if (!caught) passed = false;

let didFinally = false;
try {
  const x = 42;
  if (x !== 42) passed = false;
} catch (e) {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
