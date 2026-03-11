let passed = true;

const empty = "";
if (empty.length !== 0) passed = false;
if (empty + "hello" !== "hello") passed = false;
if ("hello" + empty !== "hello") passed = false;
if (empty.indexOf("x") !== -1) passed = false;
if (empty.trim() !== "") passed = false;

if (passed) {
  console.log("TEST_PASSED");
} else {
  console.log("FAILED");
}
