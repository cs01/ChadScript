function test(): void {
  const s = "hello world";

  const r1 = s.substr(0, 5);
  if (r1 !== "hello") {
    console.log("FAIL basic: " + r1);
    return;
  }

  const r2 = s.substr(-5);
  if (r2 !== "world") {
    console.log("FAIL negative start: " + r2);
    return;
  }

  const r3 = s.substr(-100);
  if (r3 !== "hello world") {
    console.log("FAIL very negative: " + r3);
    return;
  }

  const r4 = s.substr(100);
  if (r4 !== "") {
    console.log("FAIL past end: " + r4);
    return;
  }

  const r5 = s.substr(6, 5);
  if (r5 !== "world") {
    console.log("FAIL mid: " + r5);
    return;
  }

  const r6 = s.substr(0, 100);
  if (r6 !== "hello world") {
    console.log("FAIL len too long: " + r6);
    return;
  }

  console.log("TEST_PASSED");
}
test();
