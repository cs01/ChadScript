function test(): void {
  const s1 = "active: " + true;
  if (s1 !== "active: true") {
    console.log("FAIL literal true: " + s1);
    return;
  }
  const s2 = "done: " + false;
  if (s2 !== "done: false") {
    console.log("FAIL literal false: " + s2);
    return;
  }
  const s3 = "cmp: " + (1 > 0);
  if (s3 !== "cmp: true") {
    console.log("FAIL comparison: " + s3);
    return;
  }
  const s4 = "not: " + !(1 > 0);
  if (s4 !== "not: false") {
    console.log("FAIL negation: " + s4);
    return;
  }
  console.log("TEST_PASSED");
}
test();
