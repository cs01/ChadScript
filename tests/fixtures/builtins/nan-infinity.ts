function test(): void {
  if (Number.isNaN(NaN) !== true) {
    console.log("FAIL isNaN NaN");
    return;
  }
  if (Number.isNaN(42) !== false) {
    console.log("FAIL isNaN 42");
    return;
  }
  if (Number.isFinite(42) !== true) {
    console.log("FAIL isFinite 42");
    return;
  }
  if (Number.isFinite(Infinity) !== false) {
    console.log("FAIL isFinite Infinity");
    return;
  }
  if (Number.isInteger(42) !== true) {
    console.log("FAIL isInteger 42");
    return;
  }
  if (Number.isInteger(42.5) !== false) {
    console.log("FAIL isInteger 42.5");
    return;
  }
  console.log("TEST_PASSED");
}
test();
