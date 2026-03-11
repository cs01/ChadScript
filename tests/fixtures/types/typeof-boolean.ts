function test(): void {
  const t = true;
  const f = false;
  if (typeof t !== "boolean") {
    console.log("FAIL typeof true: " + typeof t);
    return;
  }
  if (typeof f !== "boolean") {
    console.log("FAIL typeof false: " + typeof f);
    return;
  }
  if (typeof true !== "boolean") {
    console.log("FAIL typeof literal true: " + typeof true);
    return;
  }
  if (typeof false !== "boolean") {
    console.log("FAIL typeof literal false: " + typeof false);
    return;
  }
  const x: boolean = 5 > 3;
  if (typeof x !== "boolean") {
    console.log("FAIL typeof comparison: " + typeof x);
    return;
  }
  if (typeof 42 !== "number") {
    console.log("FAIL typeof number");
    return;
  }
  if (typeof "hello" !== "string") {
    console.log("FAIL typeof string");
    return;
  }
  console.log("TEST_PASSED");
}
test();
