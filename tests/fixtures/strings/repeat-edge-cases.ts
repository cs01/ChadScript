function test(): void {
  const r1 = "ab".repeat(3);
  if (r1 !== "ababab") {
    console.log("FAIL basic: " + r1);
    return;
  }

  const r2 = "x".repeat(0);
  if (r2 !== "") {
    console.log("FAIL zero: " + r2);
    return;
  }

  const r3 = "hello".repeat(1);
  if (r3 !== "hello") {
    console.log("FAIL one: " + r3);
    return;
  }

  console.log("TEST_PASSED");
}
test();
