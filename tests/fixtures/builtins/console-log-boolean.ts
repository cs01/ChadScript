function test(): void {
  const t = true;
  const f = false;
  const result = t;
  if (result !== true) {
    console.log("FAIL basic bool");
    return;
  }
  const x: boolean = 5 > 3;
  if (x !== true) {
    console.log("FAIL comparison bool");
    return;
  }
  console.log("TEST_PASSED");
}
test();
