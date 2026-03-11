function testTypeof(): void {
  let passed = true;

  const s = "hello";
  const n = 42;

  const ts = typeof s;
  const tn = typeof n;

  if (ts !== "string") {
    console.log("FAIL: typeof s = " + ts);
    passed = false;
  }
  if (tn !== "number") {
    console.log("FAIL: typeof n = " + tn);
    passed = false;
  }

  if (typeof "literal" !== "string") {
    console.log("FAIL: typeof literal");
    passed = false;
  }
  if (typeof 123 !== "number") {
    console.log("FAIL: typeof 123");
    passed = false;
  }
  if (typeof true !== "boolean") {
    console.log("FAIL: typeof true");
    passed = false;
  }

  if (passed) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAILED");
  }
}

testTypeof();
